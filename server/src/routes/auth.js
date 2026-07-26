import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { signToken, requireAuth, COOKIE_NAME, COOKIE_MAX_AGE_MS } from '../middleware/auth.js';

const router = Router();

router.get('/status', (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'").get().count;
  res.json({ needsSetup: count === 0 });
});

router.post('/setup', (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'").get().count;
  if (count > 0) {
    return res.status(409).json({ error: 'setup has already been completed' });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), passwordHash, 'super_admin');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });
  res.status(201).json({ id: user.id, email: user.email, role: user.role, company: null, department: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });
  res.json({ id: user.id, email: user.email, role: user.role, company: user.company, department: user.department });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    company: req.user.company,
    department: req.user.department,
  });
});

export default router;
