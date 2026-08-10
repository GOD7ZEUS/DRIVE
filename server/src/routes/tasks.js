import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireRole, matchesScope, scopeClause } from '../middleware/auth.js';
import { sendTaskAssignedEmail } from '../notifications.js';

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

    const { title, description, assignee, status, due_date, milestone_id, assignee_user_id } = req.body;
    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
    }

    // Reassigning to a real Drive user requires them to be in the same
    // company+department as the task's project, same as on creation.
    let newAssigneeText = assignee !== undefined ? assignee : task.assignee;
    let newAssigneeUserId = task.assignee_user_id;
    let assigneeChangedTo = null;
    if (assignee_user_id !== undefined) {
      if (assignee_user_id === null) {
        newAssigneeUserId = null;
        newAssigneeText = '';
      } else {
        const project = await get('SELECT * FROM projects WHERE id = ?', task.project_id);
        const assigneeUser = await get(
          'SELECT * FROM users WHERE id = ? AND company_id = ? AND department_id = ?',
          assignee_user_id,
          project.company_id,
          project.department_id
        );
        if (!assigneeUser) {
          return res
            .status(400)
            .json({ error: "assignee must be an existing user in this project's company and department" });
        }
        newAssigneeUserId = assigneeUser.id;
        newAssigneeText = assigneeUser.email;
        if (assigneeUser.id !== task.assignee_user_id) assigneeChangedTo = assigneeUser;
      }
    }

    // A reassignment or a due-date change both restart the 5-day reminder
    // clock — either there's a new person who hasn't been reminded yet, or
    // the deadline moved and the old reminder timing no longer applies.
    const dueDateChanged = due_date !== undefined && due_date !== task.due_date;
    const reminderSent = assignee_user_id !== undefined || dueDateChanged ? 0 : task.reminder_sent;

    await run(
      `UPDATE tasks SET
        title = ?, description = ?, assignee = ?, assignee_user_id = ?, status = ?, due_date = ?,
        milestone_id = ?, reminder_sent = ?, updated_at = datetime('now')
       WHERE id = ?`,
      title !== undefined ? title : task.title,
      description !== undefined ? description : task.description,
      newAssigneeText,
      newAssigneeUserId,
      status !== undefined ? status : task.status,
      due_date !== undefined ? due_date : task.due_date,
      milestone_id !== undefined ? milestone_id : task.milestone_id,
      reminderSent,
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

    const updatedTask = await get('SELECT * FROM tasks WHERE id = ?', req.params.id);
    if (assigneeChangedTo) {
      const project = await get('SELECT * FROM projects WHERE id = ?', updatedTask.project_id);
      sendTaskAssignedEmail(assigneeChangedTo.email, updatedTask, project);
    }
    res.json(updatedTask);
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
