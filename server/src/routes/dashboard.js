import { Router } from 'express';
import { all } from '../db.js';
import { scopeClause } from '../middleware/auth.js';

const router = Router();

// Non-super-admins are always locked to their own company/department, no
// matter what query params they send. Super admins see everything by
// default, but can optionally filter to one company (and, within it, one
// department) via ?companyId=&departmentId=. A non-master super admin
// additionally never sees data from a company master has marked private —
// same invisibility as the Companies/Projects/Users lists. Anyone can also
// filter everything down to one person via ?userId= — a project's
// Responsible Person for project-shaped rows, a task's Assignee for
// task-shaped rows, and (since milestones have no assignee of their own)
// the parent project's Responsible Person for milestone-shaped rows.
function resolveFilter(req) {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const scope = scopeClause(req);
  if (scope) return { ...scope, userId };
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  if (req.user.is_master) {
    return companyId ? { companyId, departmentId, userId } : { userId };
  }
  return { companyId, departmentId, userId, excludePrivate: true };
}

function filterSql(filter, tablePrefix = '', userColumn = null) {
  const prefix = tablePrefix ? `${tablePrefix}.` : '';
  const conditions = [];
  const params = [];
  if (filter?.companyId) {
    conditions.push(`${prefix}company_id = ?`);
    params.push(filter.companyId);
    if (filter.departmentId) {
      conditions.push(`${prefix}department_id = ?`);
      params.push(filter.departmentId);
    }
  }
  if (filter?.excludePrivate) {
    conditions.push(`${prefix}company_id NOT IN (SELECT id FROM companies WHERE is_private = 1)`);
  }
  if (filter?.userId && userColumn) {
    conditions.push(`${userColumn} = ?`);
    params.push(filter.userId);
  }
  if (conditions.length === 0) return { where: '', and: '', params: [] };
  return { where: `WHERE ${conditions.join(' AND ')}`, and: `AND ${conditions.join(' AND ')}`, params };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = resolveFilter(req);
    const { where: projectFilter, and: projectScopeAnd, params: filterParams } = filterSql(
      filter,
      '',
      'responsible_user_id'
    );
    const { and: taskProjectFilter } = filterSql(filter, 'projects', 'tasks.assignee_user_id');
    const { and: milestoneProjectFilter } = filterSql(filter, 'projects', 'projects.responsible_user_id');

    const projectsByStatus = await all(
      `SELECT status, COUNT(*) as count FROM projects ${projectFilter} GROUP BY status`,
      ...filterParams
    );

    const tasksByStatus = await all(
      `SELECT tasks.status, COUNT(*) as count FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE 1=1 ${taskProjectFilter}
       GROUP BY tasks.status`,
      ...filterParams
    );

    const overdueTasks = await all(
      `SELECT tasks.*, projects.name as project_name FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.due_date IS NOT NULL
         AND tasks.due_date < date('now')
         AND tasks.status != 'done'
         ${taskProjectFilter}
       ORDER BY tasks.due_date ASC`,
      ...filterParams
    );

    const upcomingTasks = await all(
      `SELECT tasks.*, projects.name as project_name FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.due_date IS NOT NULL
         AND tasks.due_date >= date('now')
         AND tasks.due_date <= date('now', '+7 days')
         AND tasks.status != 'done'
         ${taskProjectFilter}
       ORDER BY tasks.due_date ASC`,
      ...filterParams
    );

    const overdueMilestones = await all(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date < date('now')
         AND milestones.status != 'done'
         ${milestoneProjectFilter}
       ORDER BY milestones.due_date ASC`,
      ...filterParams
    );

    const upcomingMilestones = await all(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date >= date('now')
         AND milestones.due_date <= date('now', '+7 days')
         AND milestones.status != 'done'
         ${milestoneProjectFilter}
       ORDER BY milestones.due_date ASC`,
      ...filterParams
    );

    // TAT (turn-around time): for a completed project, the days from creation
    // to completion. "In TAT" / "exceeding TAT" is measured against the
    // project's EARLIEST rollout date — the first one ever set for that
    // project — not whatever it's since been revised to, so a later
    // revision doesn't retroactively make a late project look on-time.
    // Projects with no rollout date set are excluded, since there's nothing
    // to measure against.
    const avgTatRow = await all(
      `SELECT AVG(julianday(completed_at) - julianday(created_at)) as avg_tat_days
       FROM projects
       WHERE completed_at IS NOT NULL ${projectScopeAnd}`,
      ...filterParams
    );
    const avgTatDays = avgTatRow[0]?.avg_tat_days != null ? Math.round(avgTatRow[0].avg_tat_days * 10) / 10 : null;

    const rolloutBaselineCte = `
      WITH project_baseline AS (
        SELECT projects.*, (
          SELECT rollout_date FROM project_rollout_dates
          WHERE project_id = projects.id ORDER BY id ASC LIMIT 1
        ) as tat_deadline
        FROM projects
      )
    `;

    const projectsExceedingTat = await all(
      `${rolloutBaselineCte}
       SELECT * FROM project_baseline
       WHERE tat_deadline IS NOT NULL
         AND (
           (status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) > date(tat_deadline))
           OR (status != 'completed' AND date(tat_deadline) < date('now'))
         )
         ${projectScopeAnd}
       ORDER BY tat_deadline ASC`,
      ...filterParams
    );

    const projectsInTat = await all(
      `${rolloutBaselineCte}
       SELECT * FROM project_baseline
       WHERE tat_deadline IS NOT NULL
         AND (
           (status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) <= date(tat_deadline))
           OR (status != 'completed' AND date(tat_deadline) >= date('now'))
         )
         ${projectScopeAnd}
       ORDER BY tat_deadline ASC`,
      ...filterParams
    );

    res.json({
      projectsByStatus,
      tasksByStatus,
      overdueTasks,
      upcomingTasks,
      overdueMilestones,
      upcomingMilestones,
      avgTatDays,
      projectsExceedingTat,
      projectsInTat,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
