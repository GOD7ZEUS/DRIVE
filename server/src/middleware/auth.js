import jwt from 'jsonwebtoken';
import { db } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in server/.env');
}

export const COOKIE_NAME = 'token';
export const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      company: user.company,
      department: user.department,
      company_id: user.company_id,
      department_id: user.department_id,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid or expired session' });
  }

  // Re-check the DB on every request so a deleted/edited account loses access
  // immediately instead of staying valid until the JWT's 7-day expiry.
  const user = db
    .prepare('SELECT id, email, role, company, department, company_id, department_id FROM users WHERE id = ?')
    .get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'account no longer exists' });
  }

  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

// Super admin sees everything; everyone else is scoped to their own company+department
// (compared by primary key, not by name, so casing/typos can't split or merge scopes).
export function scopeClause(req) {
  if (req.user.role === 'super_admin') return null;
  return { companyId: req.user.company_id, departmentId: req.user.department_id };
}

export function matchesScope(req, record) {
  const scope = scopeClause(req);
  if (!scope) return true;
  return record.company_id === scope.companyId && record.department_id === scope.departmentId;
}
