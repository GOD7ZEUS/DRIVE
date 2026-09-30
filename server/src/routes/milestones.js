import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { get, all, run, displayName, logAudit, describeChanges } from '../db.js';
import { requireRole, matchesScope, blockedByPrivacy } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'pro_admin', 'admin');
const superAdminOnly = requireRole('super_admin', 'pro_admin');
const MILESTONE_STATUSES = ['pending', 'done'];

// Milestone attachments cover things like saved mail communication, not just
// plans/screenshots — so alongside PDF/PNG/JPG this also accepts raw email
// exports (.eml/.msg). Browsers report wildly inconsistent (often blank or
// generic) MIME types for those two, so they're validated by file extension
// instead, with a sane Content-Type assigned ourselves for later downloads.
const MAX_ATTACHMENT_SIZE = 500 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const EXTENSION_CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
};
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype) && !(ext === '.eml' || ext === '.msg')) {
      return cb(new Error('only PDF, PNG, JPG, EML, or MSG files are allowed'));
    }
    cb(null, true);
  },
});

async function loadScopedMilestone(req) {
  const milestone = await get('SELECT * FROM milestones WHERE id = ?', req.params.id);
  if (!milestone) return null;
  const project = await get('SELECT * FROM projects WHERE id = ?', milestone.project_id);
  if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) return null;
  return milestone;
}

router.patch('/:id', canEdit, async (req, res, next) => {
  try {
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });

    const { title, due_date, status, sort_order } = req.body;
    if (status !== undefined && !MILESTONE_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${MILESTONE_STATUSES.join(', ')}` });
    }
    // Marking a milestone done/reopening it is everyday progress tracking,
    // open to Admins. Changing its title/due date is a structural edit,
    // reserved for Super Admin.
    if ((title !== undefined || due_date !== undefined) && !['super_admin', 'pro_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'only Super Admin can edit milestone details' });
    }

    // The first due date a milestone is ever given is kept on record forever,
    // so a later delay/revision still shows what was originally planned
    // instead of silently overwriting it.
    let originalDueDate = milestone.original_due_date;
    if (due_date !== undefined && due_date !== null && !originalDueDate) {
      originalDueDate = due_date;
    }

    await run(
      `UPDATE milestones SET title = ?, due_date = ?, original_due_date = ?, status = ?, sort_order = ? WHERE id = ?`,
      title !== undefined ? title : milestone.title,
      due_date !== undefined ? due_date : milestone.due_date,
      originalDueDate,
      status !== undefined ? status : milestone.status,
      sort_order !== undefined ? sort_order : milestone.sort_order,
      req.params.id
    );

    const afterValues = {
      title: title !== undefined ? title : milestone.title,
      due_date: due_date !== undefined ? due_date : milestone.due_date,
      status: status !== undefined ? status : milestone.status,
    };
    const changeSummary = describeChanges(milestone, afterValues, {
      title: 'title',
      due_date: 'due date',
      status: 'status',
    });
    if (changeSummary) {
      await logAudit({
        actor: req.user,
        action: 'updated',
        entityType: 'milestone',
        entityId: milestone.id,
        entityName: afterValues.title,
        details: changeSummary,
        snapshot: { before: milestone },
      });
    }

    res.json(await get('SELECT * FROM milestones WHERE id = ?', req.params.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', superAdminOnly, async (req, res, next) => {
  try {
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    // Tasks that pointed at this milestone become unassigned rather than
    // left referencing a milestone that no longer exists — recorded here so
    // a restore can re-link them, not just bring the milestone row back.
    const linkedTasks = await all('SELECT id FROM tasks WHERE milestone_id = ?', req.params.id);
    await run('UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?', req.params.id);
    await run('DELETE FROM milestones WHERE id = ?', req.params.id);
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'milestone',
      entityId: milestone.id,
      entityName: milestone.title,
      snapshot: { row: milestone, linkedTaskIds: linkedTasks.map((t) => t.id) },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments', async (req, res, next) => {
  try {
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    const attachments = await all(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM milestone_attachments WHERE milestone_id = ? ORDER BY id DESC`,
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
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const mimeType = EXTENSION_CONTENT_TYPES[ext] || req.file.mimetype;

    const result = await run(
      `INSERT INTO milestone_attachments (milestone_id, filename, mime_type, size_bytes, data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.params.id,
      req.file.originalname,
      mimeType,
      req.file.size,
      req.file.buffer,
      displayName(req.user)
    );
    const attachment = await get(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM milestone_attachments WHERE id = ?`,
      result.lastInsertRowid
    );
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    const attachment = await get(
      'SELECT * FROM milestone_attachments WHERE id = ? AND milestone_id = ?',
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
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    const attachment = await get(
      'SELECT id, filename FROM milestone_attachments WHERE id = ? AND milestone_id = ?',
      req.params.attachmentId,
      req.params.id
    );
    if (!attachment) return res.status(404).json({ error: 'attachment not found' });
    await run('DELETE FROM milestone_attachments WHERE id = ?', req.params.attachmentId);
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'milestone attachment',
      entityId: attachment.id,
      entityName: attachment.filename,
      details: `from milestone "${milestone.title}"`,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
