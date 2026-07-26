import { Router } from 'express';
import { get, all } from '../db.js';

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

export default router;
