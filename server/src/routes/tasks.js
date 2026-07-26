import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireRole, matchesScope, scopeClause } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

async function loadScopedTask(req) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', req.params.id);
  if (!task) return null;
  const project = await get('SELECT * FROM projects WHERE id = ?', task.project_id);
  if (!project || !matchesScope(req, project)) return null;
  return task;
}

router.get('/', async (req, res, next) => {
  try {
    const scope = scopeClause(req);
    const tasks = scope
      ? await all(
          `SELECT tasks.* FROM tasks
           JOIN projects ON projects.id = tasks.project_id
           WHERE projects.company_id = ? AND projects.department_id = ?
           ORDER BY tasks.created_at DESC`,
          scope.companyId,
          scope.departmentId
        )
      : await all('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', canEdit, async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });

    const { title, description, assignee, status, due_date, milestone_id } = req.body;
    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
    }

    await run(
      `UPDATE tasks SET
        title = ?, description = ?, assignee = ?, status = ?, due_date = ?, milestone_id = ?,
        updated_at = datetime('now')
       WHERE id = ?`,
      title !== undefined ? title : task.title,
      description !== undefined ? description : task.description,
      assignee !== undefined ? assignee : task.assignee,
      status !== undefined ? status : task.status,
      due_date !== undefined ? due_date : task.due_date,
      milestone_id !== undefined ? milestone_id : task.milestone_id,
      req.params.id
    );

    if (status !== undefined && status !== task.status) {
      await run(
        'INSERT INTO comments (task_id, author, body) VALUES (?, ?, ?)',
        req.params.id,
        'system',
        `Status changed from "${task.status}" to "${status}"`
      );
    }

    res.json(await get('SELECT * FROM tasks WHERE id = ?', req.params.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', canEdit, async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    await run('DELETE FROM tasks WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:id/comments', async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const comments = await all('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC', req.params.id);
    res.json(comments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', canEdit, async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });

    const { author = '', body } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const result = await run(
      'INSERT INTO comments (task_id, author, body) VALUES (?, ?, ?)',
      req.params.id,
      author,
      body.trim()
    );
    res.status(201).json(await get('SELECT * FROM comments WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

export default router;
