import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, getOrCreateCompany, getOrCreateDepartment } from '../db.js';

const router = Router();
const ASSIGNABLE_ROLES = ['admin', 'view'];

// Only the master account may create, edit, or delete other super_admin
// accounts — a regular super_admin (including the account itself) cannot.
function allowedRoles(req) {
  return req.user.is_master ? [...ASSIGNABLE_ROLES, 'super_admin'] : ASSIGNABLE_ROLES;
}

router.get('/', async (req, res, next) => {
  try {
    // The master account is invisible to regular super admins — only master sees master.
    const users = req.user.is_master
      ? await all(
          'SELECT id, email, first_name, last_name, role, company, department, company_id, department_id, is_master, created_at FROM users ORDER BY created_at ASC'
        )
      : await all(
          `SELECT id, email, first_name, last_name, role, company, department, company_id, department_id, is_master, created_at
           FROM users WHERE is_master = 0 ORDER BY created_at ASC`
        );
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { email, password, role, company, department, first_name, last_name } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!first_name || !first_name.trim() || !last_name || !last_name.trim()) {
      return res.status(400).json({ error: 'first name and last name are required' });
    }
    if (!allowedRoles(req).includes(role)) {
      return res.status(400).json({ error: `role must be one of ${allowedRoles(req).join(', ')}` });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'a user with that email already exists' });
    }

    // Super admins aren't scoped to a company/department (they see everything),
    // so unlike admin/view accounts, company+department aren't required here.
    let companyRow = { id: null, name: null };
    let departmentRow = { id: null, name: null };
    if (role !== 'super_admin') {
      if (!company || !company.trim() || !department || !department.trim()) {
        return res.status(400).json({ error: 'company and department are required' });
      }
      companyRow = await getOrCreateCompany(company);
      departmentRow = await getOrCreateDepartment(companyRow.id, department);
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await run(
      `INSERT INTO users (email, password_hash, role, company, department, company_id, department_id, first_name, last_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      email.toLowerCase(),
      passwordHash,
      role,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id,
      first_name.trim(),
      last_name.trim()
    );

    res.status(201).json(
      await get(
        'SELECT id, email, first_name, last_name, role, company, department, company_id, department_id, is_master, created_at FROM users WHERE id = ?',
        result.lastInsertRowid
      )
    );
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'user not found' });
    // The master account is invisible to non-master requesters — a 404 here,
    // not a 403, so its existence can't be inferred from the error either.
    if (user.is_master && !req.user.is_master) {
      return res.status(404).json({ error: 'user not found' });
    }
    if (user.role === 'super_admin' && !req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can modify a super admin account' });
    }
    if (user.is_master) {
      return res.status(403).json({ error: 'the master account cannot be modified from here' });
    }

    const { role, password } = req.body;
    if (role !== undefined && !allowedRoles(req).includes(role)) {
      return res.status(400).json({ error: `role must be one of ${allowedRoles(req).join(', ')}` });
    }
    if (password !== undefined && password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    await run(
      'UPDATE users SET role = ?, password_hash = ? WHERE id = ?',
      role !== undefined ? role : user.role,
      password !== undefined ? bcrypt.hashSync(password, 10) : user.password_hash,
      req.params.id
    );

    res.json(
      await get(
        'SELECT id, email, first_name, last_name, role, company, department, company_id, department_id, is_master, created_at FROM users WHERE id = ?',
        req.params.id
      )
    );
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (user.is_master && !req.user.is_master) {
      return res.status(404).json({ error: 'user not found' });
    }
    if (user.is_master) {
      return res.status(403).json({ error: 'the master account cannot be deleted from here' });
    }
    if (user.role === 'super_admin' && !req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can delete a super admin account' });
    }
    await run('DELETE FROM users WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
