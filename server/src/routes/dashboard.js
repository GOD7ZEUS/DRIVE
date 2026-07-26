import { Router } from 'express';
import { db } from '../db.js';
import { scopeClause } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  const scope = scopeClause(req);
  const projectFilter = scope ? 'WHERE company_id = ? AND department_id = ?' : '';
  const projectParams = scope ? [scope.companyId, scope.departmentId] : [];
  const taskProjectFilter = scope ? 'AND projects.company_id = ? AND projects.department_id = ?' : '';

  const projectsByStatus = db
    .prepare(`SELECT status, COUNT(*) as count FROM projects ${projectFilter} GROUP BY status`)
    .all(...projectParams);

  const tasksByStatus = db
    .prepare(
      `SELECT tasks.status, COUNT(*) as count FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE 1=1 ${taskProjectFilter}
       GROUP BY tasks.status`
    )
    .all(...projectParams);

  const overdueTasks = db
    .prepare(
      `SELECT tasks.*, projects.name as project_name FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.due_date IS NOT NULL
         AND tasks.due_date < date('now')
         AND tasks.status != 'done'
         ${taskProjectFilter}
       ORDER BY tasks.due_date ASC`
    )
    .all(...projectParams);

  const upcomingTasks = db
    .prepare(
      `SELECT tasks.*, projects.name as project_name FROM tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.due_date IS NOT NULL
         AND tasks.due_date >= date('now')
         AND tasks.due_date <= date('now', '+7 days')
         AND tasks.status != 'done'
         ${taskProjectFilter}
       ORDER BY tasks.due_date ASC`
    )
    .all(...projectParams);

  const overdueMilestones = db
    .prepare(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date < date('now')
         AND milestones.status != 'done'
         ${taskProjectFilter}
       ORDER BY milestones.due_date ASC`
    )
    .all(...projectParams);

  const upcomingMilestones = db
    .prepare(
      `SELECT milestones.*, projects.name as project_name FROM milestones
       JOIN projects ON projects.id = milestones.project_id
       WHERE milestones.due_date IS NOT NULL
         AND milestones.due_date >= date('now')
         AND milestones.due_date <= date('now', '+7 days')
         AND milestones.status != 'done'
         ${taskProjectFilter}
       ORDER BY milestones.due_date ASC`
    )
    .all(...projectParams);

  res.json({
    projectsByStatus,
    tasksByStatus,
    overdueTasks,
    upcomingTasks,
    overdueMilestones,
    upcomingMilestones,
  });
});

export default router;
