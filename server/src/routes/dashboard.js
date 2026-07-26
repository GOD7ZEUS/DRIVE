import { Router } from 'express';
import { all } from '../db.js';
import { scopeClause } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const scope = scopeClause(req);
    const projectFilter = scope ? 'WHERE company_id = ? AND department_id = ?' : '';
    const projectParams = scope ? [scope.companyId, scope.departmentId] : [];
    const taskProjectFilter = scope ? 'AND projects.company_id = ? AND projects.department_id = ?' : '';

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

    res.json({
      projectsByStatus,
      tasksByStatus,
      overdueTasks,
      upcomingTasks,
      overdueMilestones,
      upcomingMilestones,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
