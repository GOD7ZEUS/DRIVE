import { Router } from 'express';
import { db } from '../db.js';
import { requireRole, matchesScope, scopeClause } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

function loadScopedTask(req) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return null;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id);
  if (!project || !matchesScope(req, project)) return null;
  return task;
}

router.get('/', (req, res) => {
  const scope = scopeClause(req);
  const tasks = scope
    ? db
        .prepare(
          `SELECT tasks.* FROM tasks
           JOIN projects ON projects.id = tasks.project_id
           WHERE projects.company_id = ? AND projects.department_id = ?
           ORDER BY tasks.created_at DESC`
        )
        .all(scope.companyId, scope.departmentId)
    : db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  res.json(tasks);
});

router.get('/:id', (req, res) => {
  const task = loadScopedTask(req);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(task);
});

router.patch('/:id', canEdit, (req, res) => {
  const task = loadScopedTask(req);
  if (!task) return res.status(404).json({ error: 'task not found' });

  const { title, description, assignee, status, due_date, milestone_id } = req.body;
  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
  }

  db.prepare(
    `UPDATE tasks SET
      title = ?, description = ?, assignee = ?, status = ?, due_date = ?, milestone_id = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title !== undefined ? title : task.title,
    description !== undefined ? description : task.description,
    assignee !== undefined ? assignee : task.assignee,
    status !== undefined ? status : task.status,
    due_date !== undefined ? due_date : task.due_date,
    milestone_id !== undefined ? milestone_id : task.milestone_id,
    req.params.id
  );

  if (status !== undefined && status !== task.status) {
    db.prepare('INSERT INTO comments (task_id, author, body) VALUES (?, ?, ?)').run(
      req.params.id,
      'system',
      `Status changed from "${task.status}" to "${status}"`
    );
  }

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

router.delete('/:id', canEdit, (req, res) => {
  const task = loadScopedTask(req);
  if (!task) return res.status(404).json({ error: 'task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.get('/:id/comments', (req, res) => {
  const task = loadScopedTask(req);
  if (!task) return res.status(404).json({ error: 'task not found' });
  const comments = db
    .prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', canEdit, (req, res) => {
  const task = loadScopedTask(req);
  if (!task) return res.status(404).json({ error: 'task not found' });

  const { author = '', body } = req.body;
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'body is required' });
  }
  const result = db
    .prepare('INSERT INTO comments (task_id, author, body) VALUES (?, ?, ?)')
    .run(req.params.id, author, body.trim());
  res.status(201).json(db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
