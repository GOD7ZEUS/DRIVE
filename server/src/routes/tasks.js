import { Router } from 'express';
import multer from 'multer';
import { get, all, run, displayName, logAudit, describeChanges } from '../db.js';
import { requireRole, matchesScope, scopeClause, blockedByPrivacy } from '../middleware/auth.js';
import { sendTaskAssignedEmail } from '../notifications.js';

const router = Router();
const canEdit = requireRole('super_admin', 'pro_admin', 'admin');
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

// Task attachments are small BLOBs in the same database as everything else,
// same reasoning as project plan documents — Render's free-tier disk is
// wiped on every redeploy. Capped much smaller than a plan document since a
// task can carry any number of them (no limit on count, just per-file size).
const MAX_ATTACHMENT_SIZE = 500 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('only PDF, PNG, or JPG files are allowed'));
    }
    cb(null, true);
  },
});

async function loadScopedTask(req) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', req.params.id);
  if (!task) return null;
  const project = await get('SELECT * FROM projects WHERE id = ?', task.project_id);
  if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) return null;
  return task;
}

router.get('/', async (req, res, next) => {
  try {
    const scope = scopeClause(req);
    let tasks;
    if (scope) {
      tasks = await all(
        `SELECT tasks.* FROM tasks
         JOIN projects ON projects.id = tasks.project_id
         WHERE projects.company_id = ? AND projects.department_id = ?
         ORDER BY tasks.created_at DESC`,
        scope.companyId,
        scope.departmentId
      );
    } else if (req.user.is_master) {
      tasks = await all('SELECT * FROM tasks ORDER BY created_at DESC');
    } else {
      tasks = await all(
        `SELECT tasks.* FROM tasks
         JOIN projects ON projects.id = tasks.project_id
         WHERE projects.company_id NOT IN (SELECT id FROM companies WHERE is_private = 1)
         ORDER BY tasks.created_at DESC`
      );
    }
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

    // Reassigning to a real Drive user — any account in Drive is eligible,
    // not just ones in the task's own project company/department.
    let newAssigneeText = assignee !== undefined ? assignee : task.assignee;
    let newAssigneeUserId = task.assignee_user_id;
    let assigneeChangedTo = null;
    if (assignee_user_id !== undefined) {
      if (assignee_user_id === null) {
        newAssigneeUserId = null;
        newAssigneeText = '';
      } else {
        const assigneeUser = await get('SELECT * FROM users WHERE id = ? AND is_master = 0', assignee_user_id);
        if (!assigneeUser) {
          return res.status(400).json({ error: 'assignee must be an existing Drive user' });
        }
        newAssigneeUserId = assigneeUser.id;
        newAssigneeText = displayName(assigneeUser);
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

    const changeSummary = describeChanges(
      task,
      { title: updatedTask.title, assignee: newAssigneeText, status: updatedTask.status, due_date: updatedTask.due_date },
      { title: 'title', assignee: 'assignee', status: 'status', due_date: 'due date' }
    );
    if (changeSummary) {
      await logAudit({
        actor: req.user,
        action: 'updated',
        entityType: 'task',
        entityId: task.id,
        entityName: updatedTask.title,
        details: changeSummary,
      });
    }

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
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'task',
      entityId: task.id,
      entityName: task.title,
    });
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

router.get('/:id/attachments', async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const attachments = await all(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM task_attachments WHERE task_id = ? ORDER BY id DESC`,
      req.params.id
    );
    res.json(attachments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/attachments', canEdit, (req, res, next) => {
  attachmentUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const result = await run(
      `INSERT INTO task_attachments (task_id, filename, mime_type, size_bytes, data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.params.id,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
      displayName(req.user)
    );
    const attachment = await get(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM task_attachments WHERE id = ?`,
      result.lastInsertRowid
    );
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const attachment = await get(
      'SELECT * FROM task_attachments WHERE id = ? AND task_id = ?',
      req.params.attachmentId,
      req.params.id
    );
    if (!attachment) return res.status(404).json({ error: 'attachment not found' });
    res.set('Content-Type', attachment.mime_type);
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
    res.send(Buffer.from(attachment.data));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/attachments/:attachmentId', canEdit, async (req, res, next) => {
  try {
    const task = await loadScopedTask(req);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const attachment = await get(
      'SELECT id, filename FROM task_attachments WHERE id = ? AND task_id = ?',
      req.params.attachmentId,
      req.params.id
    );
    if (!attachment) return res.status(404).json({ error: 'attachment not found' });
    await run('DELETE FROM task_attachments WHERE id = ?', req.params.attachmentId);
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'task attachment',
      entityId: attachment.id,
      entityName: attachment.filename,
      details: `from task "${task.title}"`,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
