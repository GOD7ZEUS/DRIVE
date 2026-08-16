import { Router } from 'express';
import { get, all, run } from '../db.js';

const router = Router();

// A company the master account marks private is invisible to every other
// Super Admin — not just hidden from this page, but excluded from every
// listing (Projects, Users, Dashboard, assignee pickers) and 404s on direct
// access. Regular Admin/View accounts that actually belong to that company
// are unaffected — they only ever see their own company anyway. Only the
// master account can create or flip this flag. A Pro Admin is a special
// case: they always have full access to their own one assigned company
// (private or not — they're its manager), but no access to any other.
function canAccessCompany(req, company) {
  if (req.user.is_master) return true;
  if (req.user.role === 'pro_admin') return req.user.company_id === company.id;
  return !company.is_private;
}

router.get('/', async (req, res, next) => {
  try {
    let whereClause = '';
    let params = [];
    if (req.user.role === 'pro_admin') {
      whereClause = 'WHERE companies.id = ?';
      params = [req.user.company_id];
    } else if (!req.user.is_master) {
      whereClause = 'WHERE is_private = 0';
    }
    const companies = await all(
      `SELECT companies.*,
        (SELECT COUNT(*) FROM departments WHERE departments.company_id = companies.id) AS department_count,
        (SELECT COUNT(*) FROM projects WHERE projects.company_id = companies.id) AS project_count
       FROM companies
       ${whereClause}
       ORDER BY name`,
      ...params
    );
    res.json(companies);
  } catch (err) {
    next(err);
  }
});

// Companies are only ever created here — the pick-a-company fields elsewhere
// (Projects, Users) only select from what already exists. A Pro Admin is
// already scoped to one company and can't create another one.
router.post('/', async (req, res, next) => {
  try {
    if (req.user.role === 'pro_admin') {
      return res.status(403).json({ error: 'Pro Admin cannot create new companies' });
    }
    const { name, is_private } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await get('SELECT id FROM companies WHERE name = ?', name.trim());
    if (existing) {
      return res.status(409).json({ error: 'a company with that name already exists' });
    }
    // Only master can mark a company private — a regular super admin's
    // companies are always visible to every other super admin, as before.
    const makePrivate = req.user.is_master && !!is_private;
    const result = await run(
      'INSERT INTO companies (name, is_private) VALUES (?, ?)',
      name.trim(),
      makePrivate ? 1 : 0
    );
    res.status(201).json(await get('SELECT * FROM companies WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const company = await get('SELECT * FROM companies WHERE id = ?', req.params.id);
    // A private company doesn't exist as far as a non-master requester is
    // concerned — 404, not 403, so its existence can't be inferred either.
    if (!company || !canAccessCompany(req, company)) {
      return res.status(404).json({ error: 'company not found' });
    }

    const { name, is_private } = req.body;
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (name !== undefined) {
      const existing = await get('SELECT id FROM companies WHERE name = ? AND id != ?', name.trim(), req.params.id);
      if (existing) {
        return res.status(409).json({ error: 'a company with that name already exists' });
      }
    }

    const newName = name !== undefined ? name.trim() : company.name;
    const newIsPrivate = req.user.is_master && is_private !== undefined ? (is_private ? 1 : 0) : company.is_private;

    await run('UPDATE companies SET name = ?, is_private = ? WHERE id = ?', newName, newIsPrivate, req.params.id);

    // Renaming a company doesn't retroactively rename it on every project's
    // denormalized `company` text column, but every read that matters joins
    // through company_id — the plain-text copies are cosmetic/legacy fields
    // only, same as everywhere else in this app that keeps a display copy.
    res.json(await get('SELECT * FROM companies WHERE id = ?', req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/departments', async (req, res, next) => {
  try {
    const company = await get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!company || !canAccessCompany(req, company)) {
      return res.status(404).json({ error: 'company not found' });
    }

    const departments = await all(
      `SELECT departments.*,
        (SELECT COUNT(*) FROM projects WHERE projects.department_id = departments.id) AS project_count
       FROM departments
       WHERE departments.company_id = ?
       ORDER BY name`,
      req.params.id
    );
    res.json(departments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/departments', async (req, res, next) => {
  try {
    const company = await get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!company || !canAccessCompany(req, company)) {
      return res.status(404).json({ error: 'company not found' });
    }

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await get(
      'SELECT id FROM departments WHERE company_id = ? AND name = ?',
      req.params.id,
      name.trim()
    );
    if (existing) {
      return res.status(409).json({ error: 'a department with that name already exists in this company' });
    }
    const result = await run(
      'INSERT INTO departments (company_id, name) VALUES (?, ?)',
      req.params.id,
      name.trim()
    );
    res.status(201).json(await get('SELECT * FROM departments WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/departments/:deptId', async (req, res, next) => {
  try {
    const company = await get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!company || !canAccessCompany(req, company)) {
      return res.status(404).json({ error: 'company not found' });
    }
    const department = await get(
      'SELECT * FROM departments WHERE id = ? AND company_id = ?',
      req.params.deptId,
      req.params.id
    );
    if (!department) return res.status(404).json({ error: 'department not found' });

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await get(
      'SELECT id FROM departments WHERE company_id = ? AND name = ? AND id != ?',
      req.params.id,
      name.trim(),
      req.params.deptId
    );
    if (existing) {
      return res.status(409).json({ error: 'a department with that name already exists in this company' });
    }

    await run('UPDATE departments SET name = ? WHERE id = ?', name.trim(), req.params.deptId);
    res.json(await get('SELECT * FROM departments WHERE id = ?', req.params.deptId));
  } catch (err) {
    next(err);
  }
});

export default router;
