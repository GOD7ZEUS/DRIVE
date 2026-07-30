import { Router } from 'express';
import { get, all, run, getOrCreateCompany, getOrCreateDepartment } from '../db.js';
import { requireRole, matchesScope, scopeClause } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'];

router.get('/', async (req, res, next) => {
  try {
    const scope = scopeClause(req);
    const projects = scope
      ? await all(
          'SELECT * FROM projects WHERE company_id = ? AND department_id = ? ORDER BY created_at DESC',
          scope.companyId,
          scope.departmentId
        )
      : await all('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.post('/', canEdit, async (req, res, next) => {
  try {
    const { name, description = '', status = 'planning', responsible_person = '', deadline = null } = req.body;
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
      companyRow = await getOrCreateCompany(company);
      departmentRow = await getOrCreateDepartment(companyRow.id, department);
    } else {
      companyRow = { id: req.user.company_id, name: req.user.company };
      departmentRow = { id: req.user.department_id, name: req.user.department };
    }

    const result = await run(
      `INSERT INTO projects (name, description, status, company, department, company_id, department_id, responsible_person, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name.trim(),
      description,
      status,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id,
      responsible_person,
      deadline
    );
    const project = await get('SELECT * FROM projects WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

    const { name, description, status, responsible_person, deadline } = req.body;
    if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
    }

    // Track when a project actually finished (for TAT reporting), separate from
    // updated_at which changes on any edit. Re-opening a completed project
    // clears it, so re-completing it later records a fresh completion date.
    let completedAt = project.completed_at;
    if (status !== undefined && status !== project.status) {
      completedAt = status === 'completed' ? new Date().toISOString() : null;
    }

    await run(
      `UPDATE projects SET
        name = ?, description = ?, status = ?, responsible_person = ?, deadline = ?,
        completed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      name !== undefined ? name : project.name,
      description !== undefined ? description : project.description,
      status !== undefined ? status : project.status,
      responsible_person !== undefined ? responsible_person : project.responsible_person,
      deadline !== undefined ? deadline : project.deadline,
      completedAt,
      req.params.id
    );

    res.json(await get('SELECT * FROM projects WHERE id = ?', req.params.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
    await run('DELETE FROM projects WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:id/milestones', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
    const milestones = await all(
      'SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order ASC, id ASC',
      req.params.id
    );
    res.json(milestones);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/milestones', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

    const { title, due_date = null, sort_order = 0 } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const result = await run(
      'INSERT INTO milestones (project_id, title, due_date, sort_order) VALUES (?, ?, ?, ?)',
      req.params.id,
      title.trim(),
      due_date,
      sort_order
    );
    res.status(201).json(await get('SELECT * FROM milestones WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/tasks', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });
    const tasks = await all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', req.params.id);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

const TASK_STATUSES = ['todo', 'in_progress', 'done'];

router.post('/:id/tasks', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project)) return res.status(404).json({ error: 'project not found' });

    const { title, description = '', assignee = '', status = 'todo', due_date = null, milestone_id = null } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
    }
    const result = await run(
      `INSERT INTO tasks (project_id, milestone_id, title, description, assignee, status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.params.id,
      milestone_id,
      title.trim(),
      description,
      assignee,
      status,
      due_date
    );
    res.status(201).json(await get('SELECT * FROM tasks WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

export default router;
