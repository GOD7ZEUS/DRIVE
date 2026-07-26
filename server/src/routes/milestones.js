import { Router } from 'express';
import { db } from '../db.js';
import { requireRole, matchesScope } from '../middleware/auth.js';

const router = Router();
const canEdit = requireRole('super_admin', 'admin');
const MILESTONE_STATUSES = ['pending', 'done'];

function loadScopedMilestone(req) {
  const milestone = db.prepare('SELECT * FROM milestones WHERE id = ?').get(req.params.id);
  if (!milestone) return null;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(milestone.project_id);
  if (!project || !matchesScope(req, project)) return null;
  return milestone;
}

router.patch('/:id', canEdit, (req, res) => {
  const milestone = loadScopedMilestone(req);
  if (!milestone) return res.status(404).json({ error: 'milestone not found' });

  const { title, due_date, status, sort_order } = req.body;
  if (status !== undefined && !MILESTONE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${MILESTONE_STATUSES.join(', ')}` });
  }

  db.prepare(
    `UPDATE milestones SET title = ?, due_date = ?, status = ?, sort_order = ? WHERE id = ?`
  ).run(
    title !== undefined ? title : milestone.title,
    due_date !== undefined ? due_date : milestone.due_date,
    status !== undefined ? status : milestone.status,
    sort_order !== undefined ? sort_order : milestone.sort_order,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM milestones WHERE id = ?').get(req.params.id));
});

router.delete('/:id', canEdit, (req, res) => {
  const milestone = loadScopedMilestone(req);
  if (!milestone) return res.status(404).json({ error: 'milestone not found' });
  db.prepare('DELETE FROM milestones WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
