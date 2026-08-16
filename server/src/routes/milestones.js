import { Router } from 'express';
import { get, run } from '../db.js';
import { requireRole, matchesScope, blockedByPrivacy } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');
const superAdminOnly = requireRole('super_admin');
const MILESTONE_STATUSES = ['pending', 'done'];

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
    if ((title !== undefined || due_date !== undefined) && req.user.role !== 'super_admin') {
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
    // left referencing a milestone that no longer exists.
    await run('UPDATE tasks SET milestone_id = NULL WHERE milestone_id = ?', req.params.id);
    await run('DELETE FROM milestones WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
