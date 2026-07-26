import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, getOrCreateCompany, getOrCreateDepartment } from '../db.js';

const router = Router();
const ASSIGNABLE_ROLES = ['admin', 'view'];

router.get('/', (req, res) => {
  const users = db
    .prepare(
      'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users ORDER BY created_at ASC'
    )
    .all();
  res.json(users);
});

router.post('/', (req, res) => {
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'a user with that email already exists' });
  }

  const companyRow = getOrCreateCompany(company);
  const departmentRow = getOrCreateDepartment(companyRow.id, department);

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, role, company, department, company_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(email.toLowerCase(), passwordHash, role, companyRow.name, departmentRow.name, companyRow.id, departmentRow.id);

  res.status(201).json(
    db
      .prepare(
        'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users WHERE id = ?'
      )
      .get(result.lastInsertRowid)
  );
});

router.patch('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
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

  db.prepare('UPDATE users SET role = ?, password_hash = ? WHERE id = ?').run(
    role !== undefined ? role : user.role,
    password !== undefined ? bcrypt.hashSync(password, 10) : user.password_hash,
    req.params.id
  );

  res.json(
    db
      .prepare(
        'SELECT id, email, role, company, department, company_id, department_id, created_at FROM users WHERE id = ?'
      )
      .get(req.params.id)
  );
});

router.delete('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (user.role === 'super_admin') {
    return res.status(403).json({ error: 'cannot delete the super admin account' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
