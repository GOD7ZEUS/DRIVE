import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, run } from '../db.js';
import { signToken, requireAuth, COOKIE_NAME, COOKIE_MAX_AGE_MS } from '../middleware/auth.js';

const router = Router();

router.get('/status', async (req, res, next) => {
  try {
    const count = (await get("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'")).count;
    res.json({ needsSetup: count === 0 });
  } catch (err) {
    next(err);
  }
});

router.post('/setup', async (req, res, next) => {
  try {
    const count = (await get("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'")).count;
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
    const result = await run(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      email.toLowerCase(),
      passwordHash,
      'super_admin'
    );
    const user = await get('SELECT * FROM users WHERE id = ?', result.lastInsertRowid);

    const token = signToken(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
    });
    res.status(201).json({ id: user.id, email: user.email, role: user.role, company: null, department: null });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
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
  } catch (err) {
    next(err);
  }
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
