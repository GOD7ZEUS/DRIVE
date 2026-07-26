import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, getOrCreateCompany, getOrCreateDepartment } from '../db.js';

const router = Router();
const ASSIGNABLE_ROLES = ['admin', 'view'];

router.get('/', async (req, res, next) => {
  try {
    const users = await all(
      'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { email, password, role, company, department } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    if (!company || !company.trim() || !department || !department.trim()) {
      return res.status(400).json({ error: 'company and department are required' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'a user with that email already exists' });
    }

    const companyRow = await getOrCreateCompany(company);
    const departmentRow = await getOrCreateDepartment(companyRow.id, department);

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await run(
      `INSERT INTO users (email, password_hash, role, company, department, company_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      email.toLowerCase(),
      passwordHash,
      role,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id
    );

    res.status(201).json(
      await get(
        'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users WHERE id = ?',
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
    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'cannot modify the super admin account' });
    }

    const { role, password } = req.body;
    if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ASSIGNABLE_ROLES.join(', ')}` });
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
        'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users WHERE id = ?',
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
    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'cannot delete the super admin account' });
    }
    await run('DELETE FROM users WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
