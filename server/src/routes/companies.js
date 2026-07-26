import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const companies = db
    .prepare(
      `SELECT companies.*,
        (SELECT COUNT(*) FROM departments WHERE departments.company_id = companies.id) AS department_count,
        (SELECT COUNT(*) FROM projects WHERE projects.company_id = companies.id) AS project_count
       FROM companies
       ORDER BY name`
    )
    .all();
  res.json(companies);
});

router.get('/:id/departments', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'company not found' });

  const departments = db
    .prepare(
      `SELECT departments.*,
        (SELECT COUNT(*) FROM projects WHERE projects.department_id = departments.id) AS project_count
       FROM departments
       WHERE departments.company_id = ?
       ORDER BY name`
    )
    .all(req.params.id);
  res.json(departments);
});

export default router;
