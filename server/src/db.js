import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'tracker.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
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
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'company', 'TEXT');
ensureColumn('users', 'department', 'TEXT');
ensureColumn('users', 'company_id', 'INTEGER REFERENCES companies(id)');
ensureColumn('users', 'department_id', 'INTEGER REFERENCES departments(id)');
ensureColumn('projects', 'company', 'TEXT');
ensureColumn('projects', 'department', 'TEXT');
ensureColumn('projects', 'company_id', 'INTEGER REFERENCES companies(id)');
ensureColumn('projects', 'department_id', 'INTEGER REFERENCES departments(id)');

export function getOrCreateCompany(name) {
  const trimmed = name.trim();
  const existing = db.prepare('SELECT * FROM companies WHERE name = ?').get(trimmed);
  if (existing) return existing;
  const result = db.prepare('INSERT INTO companies (name) VALUES (?)').run(trimmed);
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
}

export function getOrCreateDepartment(companyId, name) {
  const trimmed = name.trim();
  const existing = db
    .prepare('SELECT * FROM departments WHERE company_id = ? AND name = ?')
    .get(companyId, trimmed);
  if (existing) return existing;
  const result = db
    .prepare('INSERT INTO departments (company_id, name) VALUES (?, ?)')
    .run(companyId, trimmed);
  return db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);
}

const superAdminCount = db
  .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'")
  .get().count;

// Dev convenience: if server/.env supplies credentials, seed immediately.
// Otherwise (e.g. a freshly installed desktop app) the first person to open
// the app is walked through creating the Super Admin via POST /api/auth/setup.
if (superAdminCount === 0 && process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const passwordHash = bcrypt.hashSync(process.env.SUPER_ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(
    email.toLowerCase(),
    passwordHash,
    'super_admin'
  );
  console.log(`Seeded super admin account: ${email}`);
}
