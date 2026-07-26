import { Router } from 'express';
import { db, getOrCreateCompany, getOrCreateDepartment } from '../db.js';
import { requireRole, matchesScope, scopeClause } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'];

router.get('/', (req, res) => {
  const scope = scopeClause(req);
  const projects = scope
    ? db
        .prepare('SELECT * FROM projects WHERE company_id = ? AND department_id = ? ORDER BY created_at DESC')
        .all(scope.companyId, scope.departmentId)
    : db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(projects);
});

router.post('/', canEdit, (req, res) => {
  const { name, description = '', status = 'planning' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
  }

  let companyRow;
  let departmentRow;
  if (req.user.role === 'super_admin') {
    const { company, department } = req.body;
    if (!company || !company.trim() || !department || !department.trim()) {
      return res.status(400).json({ error: 'company and department are required' });
    }
    companyRow = getOrCreateCompany(company);
    departmentRow = getOrCreateDepartment(companyRow.id, department);
  } else {
    companyRow = { id: req.user.company_id, name: req.user.company };
    departmentRow = { id: req.user.department_id, name: req.user.department };
  }

  const result = db
    .prepare(
      `INSERT INTO projects (name, description, status, company, department, company_id, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name.trim(), description, status, companyRow.name, departmentRow.name, companyRow.id, departmentRow.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
  res.json(project);
});

router.patch('/:id', canEdit, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

  const { name, description, status } = req.body;
  if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
  }

  db.prepare(
    `UPDATE projects SET
      name = ?, description = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name !== undefined ? name : project.name,
    description !== undefined ? description : project.description,
    status !== undefined ? status : project.status,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

router.delete('/:id', canEdit, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/:id/milestones', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
  const milestones = db
    .prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order ASC, id ASC')
    .all(req.params.id);
  res.json(milestones);
});

router.post('/:id/milestones', canEdit, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

  const { title, due_date = null, sort_order = 0 } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const result = db
    .prepare('INSERT INTO milestones (project_id, title, due_date, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, title.trim(), due_date, sort_order);
  res.status(201).json(db.prepare('SELECT * FROM milestones WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id/tasks', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json(tasks);
});

const TASK_STATUSES = ['todo', 'in_progress', 'done'];

router.post('/:id/tasks', canEdit, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

  const { title, description = '', assignee = '', status = 'todo', due_date = null, milestone_id = null } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
  }
  const result = db
    .prepare(
      `INSERT INTO tasks (project_id, milestone_id, title, description, assignee, status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, milestone_id, title.trim(), description, assignee, status, due_date);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
