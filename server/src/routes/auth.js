import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { Resend } from 'resend';
import { get, run } from '../db.js';
import { signToken, requireAuth, COOKIE_NAME, COOKIE_MAX_AGE_MS } from '../middleware/auth.js';

const router = Router();
// Optional: without a key, "forgot password" just reports itself unavailable
// instead of crashing the whole server (e.g. plain local dev with no email set up).
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const OTP_TTL_MS = 10 * 60 * 1000;

// Blunt brute-force protection: caps guesses at a password (or spam account-setup
// attempts) per IP, independent of whether the guess was right or wrong.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, please try again in a few minutes' },
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: COOKIE_MAX_AGE_MS,
};

router.get('/status', async (req, res, next) => {
  try {
    const count = (await get("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'")).count;
    res.json({ needsSetup: count === 0 });
  } catch (err) {
    next(err);
  }
});

router.post('/setup', authLimiter, async (req, res, next) => {
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
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.status(201).json({ id: user.id, email: user.email, role: user.role, company: null, department: null });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
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
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    res.json({ id: user.id, email: user.email, role: user.role, company: user.company, department: user.department });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: COOKIE_OPTIONS.secure });
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

router.post('/change-password', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'new password must be at least 6 characters' });
    }

    const user = await get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    if (!resend) {
      return res.status(503).json({ error: 'password reset by email is not configured on this server' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    // Same response whether or not the account exists, so this endpoint can't be
    // used to discover which emails have accounts.
    if (user) {
      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = bcrypt.hashSync(otp, 10);
      const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
      await run('UPDATE users SET reset_otp_hash = ?, reset_otp_expires = ? WHERE id = ?', otpHash, expires, user.id);

      await resend.emails.send({
        from: 'Drive <onboarding@resend.dev>',
        to: user.email,
        subject: 'Your Drive password reset code',
        html: `<p>Your password reset code is <strong>${otp}</strong>.</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
      });
    }

    res.json({ message: 'If that email has an account, a reset code has been sent.' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'email, otp, and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'new password must be at least 6 characters' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    const invalid = () => res.status(400).json({ error: 'invalid or expired code' });

    if (!user || !user.reset_otp_hash || !user.reset_otp_expires) return invalid();
    if (new Date(user.reset_otp_expires).getTime() < Date.now()) return invalid();
    if (!bcrypt.compareSync(otp, user.reset_otp_hash)) return invalid();

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await run(
      'UPDATE users SET password_hash = ?, reset_otp_hash = NULL, reset_otp_expires = NULL WHERE id = ?',
      passwordHash,
      user.id
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
