import { Router } from 'express';
import { all } from '../db.js';
import { scopeClause } from '../middleware/auth.js';

const router = Router();

// Non-super-admins are always locked to their own company/department, no
// matter what query params they send. Super admins see everything by
// default, but can optionally filter to one company (and, within it, one
// department) via ?companyId=&departmentId=.
function resolveFilter(req) {
  const scope = scopeClause(req);
  if (scope) return scope;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  if (!companyId) return null;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  return { companyId, departmentId };
}

function filterSql(filter, tablePrefix = '') {
  if (!filter) return { where: '', and: '', params: [] };
  const prefix = tablePrefix ? `${tablePrefix}.` : '';
  const conditions = [`${prefix}company_id = ?`];
  const params = [filter.companyId];
  if (filter.departmentId) {
    conditions.push(`${prefix}department_id = ?`);
    params.push(filter.departmentId);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, and: `AND ${conditions.join(' AND ')}`, params };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = resolveFilter(req);
    const { where: projectFilter, params: projectParams } = filterSql(filter);
    const { and: taskProjectFilter } = filterSql(filter, 'projects');
    const { and: projectScopeAnd } = filterSql(filter);

    const projectsByStatus = await all(
      `SELECT status, COUNT(*) as count FROM projects ${projectFilter} GROUP BY status`,
      ...projectParams
    );

    const tasksByStatus = await all(
      `SELECT tasks.status, COUNT(*) as count FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE 1=1 ${taskProjectFilter}
       GROUP BY tasks.status`,
      ...projectParams
    );

    const overdueTasks = await all(
      `SELECT tasks.*, projects.name as project_name FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.due_date IS NOT NULL
         AND tasks.due_date < date('now')
         AND tasks.status != 'done'
         ${taskProjectFilter}
       ORDER BY tasks.due_date ASC`,
      ...projectParams
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
      ...projectParams
    );

    const overdueMilestones = await all(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date < date('now')
         AND milestones.status != 'done'
         ${taskProjectFilter}
       ORDER BY milestones.due_date ASC`,
      ...projectParams
    );

    const upcomingMilestones = await all(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date >= date('now')
         AND milestones.due_date <= date('now', '+7 days')
         AND milestones.status != 'done'
         ${taskProjectFilter}
       ORDER BY milestones.due_date ASC`,
      ...projectParams
    );

    // TAT (turn-around time): for a completed project, the days from creation
    // to completion. "In TAT" / "exceeding TAT" is measured against the
    // project's deadline — completed late, or still open and past its
    // deadline, counts as exceeding. Projects with no deadline set are
    // excluded, since there's nothing to measure against.
    const avgTatRow = await all(
      `SELECT AVG(julianday(completed_at) - julianday(created_at)) as avg_tat_days
       FROM projects
       WHERE completed_at IS NOT NULL ${projectScopeAnd}`,
      ...projectParams
    );
    const avgTatDays = avgTatRow[0]?.avg_tat_days != null ? Math.round(avgTatRow[0].avg_tat_days * 10) / 10 : null;

    const projectsExceedingTat = await all(
      `SELECT * FROM projects
       WHERE deadline IS NOT NULL
         AND (
           (status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) > date(deadline))
           OR (status != 'completed' AND date(deadline) < date('now'))
         )
         ${projectScopeAnd}
       ORDER BY deadline ASC`,
      ...projectParams
    );

    const projectsInTat = await all(
      `SELECT * FROM projects
       WHERE deadline IS NOT NULL
         AND (
           (status = 'completed' AND completed_at IS NOT NULL AND date(completed_at) <= date(deadline))
           OR (status != 'completed' AND date(deadline) >= date('now'))
         )
         ${projectScopeAnd}
       ORDER BY deadline ASC`,
      ...projectParams
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
