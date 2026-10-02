import { Router } from 'express';
import { all, get } from '../db.js';
import { scopeClause } from '../middleware/auth.js';

const router = Router();

// Non-super-admins are always locked to their own company/department, no
// matter what query params they send. Super admins see everything by
// default, but can optionally filter to one company (and, within it, one
// department) via ?companyId=&departmentId=. A non-master super admin
// additionally never sees data from a company master has marked private —
// same invisibility as the Companies/Projects/Users lists.
function resolveFilter(req) {
  const scope = scopeClause(req);
  if (scope) return scope;
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  if (req.user.is_master) {
    return companyId ? { companyId, departmentId } : null;
  }
  return { companyId, departmentId, excludePrivate: true };
}

function filterSql(filter, tablePrefix = '') {
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
  if (conditions.length === 0) return { where: '', and: '', params: [] };
  return { where: `WHERE ${conditions.join(' AND ')}`, and: `AND ${conditions.join(' AND ')}`, params };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = resolveFilter(req);
    const { where: projectFilter, params: filterParams } = filterSql(filter);
    const { and: taskProjectFilter } = filterSql(filter, 'projects');
    const { and: projectScopeAnd } = filterSql(filter);

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
         ${taskProjectFilter}
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
         ${taskProjectFilter}
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
       SELECT id, name, status, company, department, tat_deadline, completed_at FROM project_baseline
       WHERE tat_deadline IS NOT NULL
         AND (
           (status IN ('completed', 'live') AND completed_at IS NOT NULL AND date(completed_at) > date(tat_deadline))
           OR (status NOT IN ('completed', 'live') AND date(tat_deadline) < date('now'))
         )
         ${projectScopeAnd}
       ORDER BY tat_deadline ASC`,
      ...filterParams
    );

    const projectsInTat = await all(
      `${rolloutBaselineCte}
       SELECT id, name, status, company, department, tat_deadline, completed_at FROM project_baseline
       WHERE tat_deadline IS NOT NULL
         AND (
           (status IN ('completed', 'live') AND completed_at IS NOT NULL AND date(completed_at) <= date(tat_deadline))
           OR (status NOT IN ('completed', 'live') AND date(tat_deadline) >= date('now'))
         )
         ${projectScopeAnd}
       ORDER BY tat_deadline ASC`,
      ...filterParams
    );

    // ── Advanced dashboard data. Same scoping as everything above. ──────────
    const currentRollout = `(SELECT rollout_date FROM project_rollout_dates
      WHERE project_id = projects.id ORDER BY id DESC LIMIT 1)`;

    const milestoneTotals = await get(
      `SELECT COUNT(*) as total, SUM(CASE WHEN milestones.status = 'done' THEN 1 ELSE 0 END) as done
       FROM milestones JOIN projects ON projects.id = milestones.project_id
       WHERE 1=1 ${taskProjectFilter}`,
      ...filterParams
    );

    // Open projects bucketed by how close their current rollout date is.
    const health = await get(
      `SELECT
         SUM(CASE WHEN r IS NULL THEN 1 ELSE 0 END) as no_date,
         SUM(CASE WHEN r < date('now') THEN 1 ELSE 0 END) as overdue,
         SUM(CASE WHEN r >= date('now') AND r <= date('now', '+14 days') THEN 1 ELSE 0 END) as due_soon,
         SUM(CASE WHEN r > date('now', '+14 days') THEN 1 ELSE 0 END) as on_track
       FROM (SELECT ${currentRollout} as r FROM projects WHERE status NOT IN ('completed', 'live') ${taskProjectFilter})`,
      ...filterParams
    );

    // Tasks completed per month over the last 12 months (gaps filled below).
    const completedRows = await all(
      `SELECT strftime('%Y-%m', tasks.completed_at) as month, COUNT(*) as count
       FROM tasks JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.status = 'done' AND tasks.completed_at >= date('now', 'start of month', '-11 months')
         ${taskProjectFilter}
       GROUP BY month`,
      ...filterParams
    );
    const createdRows = await all(
      `SELECT strftime('%Y-%m', tasks.created_at) as month, COUNT(*) as count
       FROM tasks JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.created_at >= date('now', 'start of month', '-11 months') ${taskProjectFilter}
       GROUP BY month`,
      ...filterParams
    );

    // Open projects rolling out in each of the next 6 months.
    const rolloutRows = await all(
      `SELECT strftime('%Y-%m', r) as month, COUNT(*) as count
       FROM (SELECT ${currentRollout} as r FROM projects WHERE status NOT IN ('completed', 'live') ${taskProjectFilter})
       WHERE r >= date('now', 'start of month') AND r < date('now', 'start of month', '+6 months')
       GROUP BY month`,
      ...filterParams
    );

    const monthKeys = (startOffset, count) => {
      const now = new Date();
      return Array.from({ length: count }, (_, i) => {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + startOffset + i, 1));
        return d.toISOString().slice(0, 7);
      });
    };
    const fill = (keys, rows) => {
      const byMonth = new Map(rows.map((r) => [r.month, r.count]));
      return keys.map((month) => ({ month, count: byMonth.get(month) || 0 }));
    };
    const pastMonths = monthKeys(-11, 12);
    const taskThroughput = pastMonths.map((month, i) => ({
      month,
      created: fill(pastMonths, createdRows)[i].count,
      completed: fill(pastMonths, completedRows)[i].count,
    }));
    const rolloutsByMonth = fill(monthKeys(0, 6), rolloutRows);

    const upcomingRollouts = await all(
      `SELECT * FROM (
         SELECT id, name, status, responsible_person, ${currentRollout} as rollout_date
         FROM projects WHERE status NOT IN ('completed', 'live') ${taskProjectFilter}
       )
       WHERE rollout_date >= date('now') AND rollout_date <= date('now', '+30 days')
       ORDER BY rollout_date ASC`,
      ...filterParams
    );

    // Workload per person: open projects they're responsible for, and the
    // open/overdue tasks assigned to them. Keyed on the display name, which
    // is what both columns store alongside the user id.
    const ownerRows = await all(
      `SELECT responsible_person as person, COUNT(*) as projects
       FROM projects WHERE status NOT IN ('completed', 'live') AND responsible_person != '' ${taskProjectFilter}
       GROUP BY responsible_person`,
      ...filterParams
    );
    const assigneeRows = await all(
      `SELECT tasks.assignee as person, COUNT(*) as open_tasks,
         SUM(CASE WHEN tasks.due_date IS NOT NULL AND tasks.due_date < date('now') THEN 1 ELSE 0 END) as overdue_tasks
       FROM tasks JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.status != 'done' AND tasks.assignee != '' ${taskProjectFilter}
       GROUP BY tasks.assignee`,
      ...filterParams
    );
    const workloadMap = new Map();
    const entry = (person) => {
      if (!workloadMap.has(person)) workloadMap.set(person, { person, projects: 0, open_tasks: 0, overdue_tasks: 0 });
      return workloadMap.get(person);
    };
    for (const r of ownerRows) entry(r.person).projects = r.projects;
    for (const r of assigneeRows) Object.assign(entry(r.person), { open_tasks: r.open_tasks, overdue_tasks: r.overdue_tasks });
    const workload = [...workloadMap.values()]
      .sort((a, b) => b.projects + b.open_tasks - (a.projects + a.open_tasks))
      .slice(0, 10);

    // Project status per company (only interesting when more than one shows).
    const byCompany = await all(
      `SELECT company_id, company,
         SUM(CASE WHEN status = 'planning' THEN 1 ELSE 0 END) as planning,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) as on_hold,
         SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         COUNT(*) as total
       FROM projects WHERE 1=1 ${taskProjectFilter}
       GROUP BY company_id ORDER BY total DESC`,
      ...filterParams
    );

    res.json({
      milestones: { total: milestoneTotals?.total || 0, done: milestoneTotals?.done || 0 },
      health: {
        on_track: health?.on_track || 0,
        due_soon: health?.due_soon || 0,
        overdue: health?.overdue || 0,
        no_date: health?.no_date || 0,
      },
      taskThroughput,
      rolloutsByMonth,
      upcomingRollouts,
      workload,
      byCompany,
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
