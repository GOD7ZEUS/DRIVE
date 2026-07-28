import { Router } from 'express';
import { get, all, run } from '../db.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const companies = await all(
      `SELECT companies.*,
        (SELECT COUNT(*) FROM departments WHERE departments.company_id = companies.id) AS department_count,
        (SELECT COUNT(*) FROM projects WHERE projects.company_id = companies.id) AS project_count
       FROM companies
       ORDER BY name`
    );
    res.json(companies);
  } catch (err) {
    next(err);
  }
});

// Companies are only ever created here — the pick-a-company fields elsewhere
// (Projects, Users) only select from what already exists.
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const existing = await get('SELECT id FROM companies WHERE name = ?', name.trim());
    if (existing) {
      return res.status(409).json({ error: 'a company with that name already exists' });
    }
    const result = await run('INSERT INTO companies (name) VALUES (?)', name.trim());
    res.status(201).json(await get('SELECT * FROM companies WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/departments', async (req, res, next) => {
  try {
    const company = await get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!company) return res.status(404).json({ error: 'company not found' });

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
    if (!company) return res.status(404).json({ error: 'company not found' });

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

export default router;
