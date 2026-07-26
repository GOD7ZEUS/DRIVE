import { Router } from 'express';
import { get, run } from '../db.js';
import { requireRole, matchesScope } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');
const MILESTONE_STATUSES = ['pending', 'done'];

async function loadScopedMilestone(req) {
  const milestone = await get('SELECT * FROM milestones WHERE id = ?', req.params.id);
  if (!milestone) return null;
  const project = await get('SELECT * FROM projects WHERE id = ?', milestone.project_id);
  if (!project || !matchesScope(req, project)) return null;
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

    await run(
      `UPDATE milestones SET title = ?, due_date = ?, status = ?, sort_order = ? WHERE id = ?`,
      title !== undefined ? title : milestone.title,
      due_date !== undefined ? due_date : milestone.due_date,
      status !== undefined ? status : milestone.status,
      sort_order !== undefined ? sort_order : milestone.sort_order,
      req.params.id
    );

    res.json(await get('SELECT * FROM milestones WHERE id = ?', req.params.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', canEdit, async (req, res, next) => {
  try {
    const milestone = await loadScopedMilestone(req);
    if (!milestone) return res.status(404).json({ error: 'milestone not found' });
    await run('DELETE FROM milestones WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
