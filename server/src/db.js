import { createClient } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Turso (remote, persistent) in production if configured; otherwise a local
// file — same libSQL client either way, so local dev needs no cloud account.
const dbUrl = process.env.TURSO_DATABASE_URL
  ? process.env.TURSO_DATABASE_URL
  : pathToFileURL(process.env.DB_PATH || path.join(__dirname, '..', 'tracker.db')).href;

export const db = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Thin sync-shaped helpers so call sites read like `await get(sql, ...args)`
// instead of juggling `db.execute({ sql, args })` and result-row shapes everywhere.
export async function get(sql, ...args) {
  const rs = await db.execute({ sql, args });
  return rs.rows[0];
}

export async function all(sql, ...args) {
  const rs = await db.execute({ sql, args });
  return rs.rows;
}

export async function run(sql, ...args) {
  const rs = await db.execute({ sql, args });
  return {
    lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
    changes: rs.rowsAffected,
  };
}

await db.execute('PRAGMA foreign_keys = ON');

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planning',
    company TEXT,
    department TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    assignee TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author TEXT DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'view')),
    company TEXT,
    department TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, name)
  );

  CREATE TABLE IF NOT EXISTS project_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,
    uploaded_by TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_rollout_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rollout_date TEXT NOT NULL,
    set_by TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

async function ensureColumn(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

await ensureColumn('users', 'company', 'TEXT');
await ensureColumn('users', 'department', 'TEXT');
await ensureColumn('users', 'company_id', 'INTEGER REFERENCES companies(id)');
await ensureColumn('users', 'department_id', 'INTEGER REFERENCES departments(id)');
await ensureColumn('projects', 'company', 'TEXT');
await ensureColumn('projects', 'department', 'TEXT');
await ensureColumn('projects', 'company_id', 'INTEGER REFERENCES companies(id)');
await ensureColumn('projects', 'department_id', 'INTEGER REFERENCES departments(id)');
await ensureColumn('projects', 'responsible_person', 'TEXT');
await ensureColumn('projects', 'deadline', 'TEXT');
await ensureColumn('users', 'reset_otp_hash', 'TEXT');
await ensureColumn('users', 'reset_otp_expires', 'TEXT');
await ensureColumn('users', 'reset_otp_attempts', 'INTEGER NOT NULL DEFAULT 0');
await ensureColumn('users', 'reset_otp_locked_until', 'TEXT');
await ensureColumn('users', 'is_master', 'INTEGER NOT NULL DEFAULT 0');
await ensureColumn('users', 'security_question', 'TEXT');
await ensureColumn('users', 'security_answer_hash', 'TEXT');
await ensureColumn('projects', 'completed_at', 'TEXT');
await ensureColumn('tasks', 'assignee_user_id', 'INTEGER REFERENCES users(id)');
await ensureColumn('tasks', 'reminder_sent', 'INTEGER NOT NULL DEFAULT 0');
await ensureColumn('projects', 'original_deadline', 'TEXT');
await ensureColumn('users', 'first_name', 'TEXT');
await ensureColumn('users', 'last_name', 'TEXT');
await ensureColumn('projects', 'responsible_user_id', 'INTEGER REFERENCES users(id)');
await ensureColumn('milestones', 'original_due_date', 'TEXT');
await ensureColumn('companies', 'is_private', 'INTEGER NOT NULL DEFAULT 0');

// SQLite has no ALTER TABLE for CHECK constraints, so adding the pro_admin
// role means rebuilding the users table: copy every existing column
// definition, widen just the role CHECK, copy the data across, then swap.
// Idempotent — skipped once the live table's own DDL already allows it.
async function ensureProAdminRole() {
  const tableSql = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (tableSql?.sql?.includes('pro_admin')) return;

  const columns = await all('PRAGMA table_info(users)');
  const colDefs = columns.map((c) => {
    let def = `${c.name} ${c.type}`;
    if (c.name === 'role') {
      def += ` NOT NULL CHECK (role IN ('super_admin', 'admin', 'view', 'pro_admin'))`;
      return def;
    }
    if (c.notnull) def += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) def += ` DEFAULT (${c.dflt_value})`;
    if (c.pk) def += ' PRIMARY KEY AUTOINCREMENT';
    return def;
  });
  const colNames = columns.map((c) => c.name).join(', ');

  await db.execute('PRAGMA foreign_keys = OFF');
  await db.execute(`CREATE TABLE users_new (${colDefs.join(', ')})`);
  await db.execute(`INSERT INTO users_new (${colNames}) SELECT ${colNames} FROM users`);
  await db.execute('DROP TABLE users');
  await db.execute('ALTER TABLE users_new RENAME TO users');
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)');
  await db.execute('PRAGMA foreign_keys = ON');
}
await ensureProAdminRole();

// Users created before first/last name existed have neither — fall back to
// their email so every list/dropdown always has something to show.
export function displayName(user) {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email;
}

export async function getOrCreateCompany(name) {
  const trimmed = name.trim();
  const existing = await get('SELECT * FROM companies WHERE name = ?', trimmed);
  if (existing) return existing;
  const result = await run('INSERT INTO companies (name) VALUES (?)', trimmed);
  return get('SELECT * FROM companies WHERE id = ?', result.lastInsertRowid);
}

export async function getOrCreateDepartment(companyId, name) {
  const trimmed = name.trim();
  const existing = await get(
    'SELECT * FROM departments WHERE company_id = ? AND name = ?',
    companyId,
    trimmed
  );
  if (existing) return existing;
  const result = await run(
    'INSERT INTO departments (company_id, name) VALUES (?, ?)',
    companyId,
    trimmed
  );
  return get('SELECT * FROM departments WHERE id = ?', result.lastInsertRowid);
}

const superAdminCount = (await get("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'"))
  .count;

// Dev convenience: if server/.env supplies credentials, seed immediately.
// Otherwise (e.g. a freshly installed desktop app, or a fresh Turso database)
// the first person to open the app is walked through creating the Super Admin
// via POST /api/auth/setup.
if (superAdminCount === 0 && process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const passwordHash = bcrypt.hashSync(process.env.SUPER_ADMIN_PASSWORD, 10);
  await run(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
    email.toLowerCase(),
    passwordHash,
    'super_admin'
  );
  console.log(`Seeded super admin account: ${email}`);
}

// The master account is a super_admin with an extra flag that gates who can
// create/edit/delete other super_admin accounts (see users.js). Seeded from
// env vars the same way as the initial super admin — idempotent, so it's
// safe to leave these vars set permanently (it only acts once per email).
if (process.env.MASTER_EMAIL && process.env.MASTER_PASSWORD) {
  const masterEmail = process.env.MASTER_EMAIL.toLowerCase();
  const existingMaster = await get('SELECT * FROM users WHERE email = ?', masterEmail);
  if (!existingMaster) {
    const passwordHash = bcrypt.hashSync(process.env.MASTER_PASSWORD, 10);
    await run(
      'INSERT INTO users (email, password_hash, role, is_master) VALUES (?, ?, ?, 1)',
      masterEmail,
      passwordHash,
      'super_admin'
    );
    console.log(`Seeded master account: ${masterEmail}`);
  } else if (!existingMaster.is_master) {
    await run("UPDATE users SET is_master = 1, role = 'super_admin' WHERE id = ?", existingMaster.id);
    console.log(`Promoted existing account to master: ${masterEmail}`);
  }
}
