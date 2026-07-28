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
const OTP_MAX_ATTEMPTS = 3;
const OTP_LOCKOUT_MS = 24 * 60 * 60 * 1000;

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

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    company: user.company,
    department: user.department,
    company_id: user.company_id,
    department_id: user.department_id,
    is_master: !!user.is_master,
    has_security_question: !!user.security_question,
  };
}

async function sendOtp(user) {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = bcrypt.hashSync(otp, 10);
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await run(
    'UPDATE users SET reset_otp_hash = ?, reset_otp_expires = ?, reset_otp_attempts = 0 WHERE id = ?',
    otpHash,
    expires,
    user.id
  );
  await resend.emails.send({
    from: 'Drive <onboarding@resend.dev>',
    to: user.email,
    subject: 'Your Drive password reset code',
    html: `<p>Your password reset code is <strong>${otp}</strong>.</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
  });
}

function lockedResponse(res, user) {
  const remainingMs = new Date(user.reset_otp_locked_until).getTime() - Date.now();
  const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
  return res
    .status(423)
    .json({ error: `too many failed codes — try again in about ${remainingHours} hour(s)` });
}

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
    res.status(201).json(publicUser(user));
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
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: COOKIE_OPTIONS.secure });
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
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

router.post('/security-question', requireAuth, async (req, res, next) => {
  try {
    const { question, answer } = req.body;
    if (!question || !question.trim() || !answer || !answer.trim()) {
      return res.status(400).json({ error: 'question and answer are required' });
    }
    const answerHash = bcrypt.hashSync(answer.trim().toLowerCase(), 10);
    await run(
      'UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?',
      question.trim(),
      answerHash,
      req.user.id
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Step 1 of password recovery: look up the account's security question.
// Returns { question: null } both when the account doesn't exist and when it
// exists but hasn't set one up yet, so this can't be used to probe which
// emails have accounts.
router.post('/forgot-password/question', authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    res.json({ question: user && user.security_question ? user.security_question : null });
  } catch (err) {
    next(err);
  }
});

// Step 2: verify the security answer. On success, emails an OTP.
router.post('/forgot-password/verify-answer', authLimiter, async (req, res, next) => {
  try {
    if (!resend) {
      return res.status(503).json({ error: 'password reset by email is not configured on this server' });
    }
    const { email, answer } = req.body;
    if (!email || !answer) {
      return res.status(400).json({ error: 'email and answer are required' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    const invalid = () => res.status(400).json({ error: 'incorrect answer' });
    if (!user || !user.security_answer_hash) return invalid();
    if (user.reset_otp_locked_until && new Date(user.reset_otp_locked_until).getTime() > Date.now()) {
      return lockedResponse(res, user);
    }
    if (!bcrypt.compareSync(answer.trim().toLowerCase(), user.security_answer_hash)) return invalid();

    await sendOtp(user);
    res.json({ message: 'A reset code has been sent to your email.' });
  } catch (err) {
    next(err);
  }
});

// "Try another way": skip the security question and email an OTP directly,
// for someone who can't answer it. Same response regardless of whether the
// account exists, so this can't be used to probe which emails have accounts.
router.post('/forgot-password/send-otp', authLimiter, async (req, res, next) => {
  try {
    if (!resend) {
      return res.status(503).json({ error: 'password reset by email is not configured on this server' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
    if (user) {
      if (user.reset_otp_locked_until && new Date(user.reset_otp_locked_until).getTime() > Date.now()) {
        return lockedResponse(res, user);
      }
      await sendOtp(user);
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

    if (!user) return invalid();
    // Check the lock before the hash/expiry — a lockout clears reset_otp_hash,
    // so without this order a locked-out user just sees "invalid code" instead
    // of knowing they're locked out and for how long.
    if (user.reset_otp_locked_until && new Date(user.reset_otp_locked_until).getTime() > Date.now()) {
      return lockedResponse(res, user);
    }
    if (!user.reset_otp_hash || !user.reset_otp_expires) return invalid();
    if (new Date(user.reset_otp_expires).getTime() < Date.now()) return invalid();

    if (!bcrypt.compareSync(otp, user.reset_otp_hash)) {
      const attempts = (user.reset_otp_attempts || 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + OTP_LOCKOUT_MS).toISOString();
        await run(
          'UPDATE users SET reset_otp_hash = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, reset_otp_locked_until = ? WHERE id = ?',
          lockedUntil,
          user.id
        );
        return res.status(423).json({ error: 'too many failed codes — try again in 24 hours' });
      }
      await run('UPDATE users SET reset_otp_attempts = ? WHERE id = ?', attempts, user.id);
      return res
        .status(400)
        .json({ error: `incorrect code — ${OTP_MAX_ATTEMPTS - attempts} attempt(s) left` });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await run(
      `UPDATE users SET
        password_hash = ?, reset_otp_hash = NULL, reset_otp_expires = NULL,
        reset_otp_attempts = 0, reset_otp_locked_until = NULL
       WHERE id = ?`,
      passwordHash,
      user.id
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
