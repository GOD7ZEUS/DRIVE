import { Router } from 'express';
import multer from 'multer';
import { get, all, run, getOrCreateCompany, getOrCreateDepartment, displayName } from '../db.js';
import { requireRole, matchesScope, scopeClause, blockedByPrivacy } from '../middleware/auth.js';
import { sendTaskAssignedEmail } from '../notifications.js';

const router = Router();
const canEdit = requireRole('super_admin', 'pro_admin', 'admin');
const superAdminOnly = requireRole('super_admin', 'pro_admin');

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'];

// Plan documents are kept as small BLOBs in the same database as everything
// else rather than on local disk — Render's free tier disk is wiped on every
// redeploy, which would silently lose every uploaded plan. The size cap
// keeps that comfortably within a normal database's storage budget.
const MAX_PLAN_SIZE = 5 * 1024 * 1024;
const ALLOWED_PLAN_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const planUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PLAN_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_PLAN_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('only PDF, PNG, or JPG files are allowed'));
    }
    cb(null, true);
  },
});

// The project's rollout date now lives in project_rollout_dates (full
// history, revisable only by Super Admin) rather than a plain column, so
// every project read pulls in the current (most recent) one as a computed
// field for display.
const CURRENT_ROLLOUT_DATE_SUBQUERY = `(
  SELECT rollout_date FROM project_rollout_dates
  WHERE project_id = projects.id ORDER BY id DESC LIMIT 1
) as current_rollout_date`;

// A company the master account marks private is invisible to every other
// Super Admin. Admin/View accounts are unaffected — matchesScope already
// locks them to their own company regardless.
const PRIVATE_COMPANY_EXCLUSION = 'company_id NOT IN (SELECT id FROM companies WHERE is_private = 1)';

// A company with an assigned Pro Admin has its admin/view accounts made
// exclusive to that Pro Admin + master (see users.js) — the assignee/
// responsible-person pickers below must honor the same exclusion, or a
// regular Super Admin could still see and assign tasks to a "hidden" user.
const PRO_ADMIN_EXCLUSIVITY = `(
  role = 'pro_admin'
  OR company_id IS NULL
  OR company_id NOT IN (SELECT company_id FROM users WHERE role = 'pro_admin' AND company_id IS NOT NULL)
)`;

// Master and a regular Super Admin keep the standing "every user in Drive,
// any company" policy for assignee pickers — except a user belonging to a
// pro-admin-managed company, which the exclusivity rule above still hides.
// A Pro Admin is different: their own company is meant to stay siloed even
// from them assigning outward, so their picker is narrowed to just their own
// company's accounts (i.e. themselves plus whoever they've created).
function assignableUsersFilter(req) {
  if (req.user.is_master) return { sql: '', params: [] };
  if (req.user.role === 'pro_admin') return { sql: 'AND company_id = ?', params: [req.user.company_id] };
  return {
    sql: `AND (company_id IS NULL OR ${PRIVATE_COMPANY_EXCLUSION}) AND ${PRO_ADMIN_EXCLUSIVITY}`,
    params: [],
  };
}

router.get('/', async (req, res, next) => {
  try {
    const scope = scopeClause(req);
    let projects;
    if (scope) {
      projects = await all(
        `SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects
         WHERE company_id = ? AND department_id = ? ORDER BY created_at DESC`,
        scope.companyId,
        scope.departmentId
      );
    } else if (req.user.is_master) {
      projects = await all(`SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects ORDER BY created_at DESC`);
    } else {
      projects = await all(
        `SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects
         WHERE ${PRIVATE_COMPANY_EXCLUSION} ORDER BY created_at DESC`
      );
    }
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.post('/', canEdit, async (req, res, next) => {
  try {
    const { name, description = '', status = 'planning', responsible_user_id = null } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
    }

    let companyRow;
    let departmentRow;
    if (req.user.role === 'super_admin') {
      const { company, department } = req.body;
      if (!company || !company.trim() || !department || !department.trim()) {
        return res.status(400).json({ error: 'company and department are required' });
      }
      companyRow = await getOrCreateCompany(company);
      // A non-master super admin can't see private companies in the picker,
      // but could still type an exact name match — block that explicitly
      // rather than silently attaching their new project to a hidden company.
      if (companyRow.is_private && !req.user.is_master) {
        return res.status(400).json({ error: 'company and department are required' });
      }
      departmentRow = await getOrCreateDepartment(companyRow.id, department);
    } else if (req.user.role === 'pro_admin') {
      // A Pro Admin's company is fixed, but they oversee every department in
      // it, so — unlike Admin/View — they still pick which one it goes under.
      const { department } = req.body;
      if (!department || !department.trim()) {
        return res.status(400).json({ error: 'department is required' });
      }
      companyRow = { id: req.user.company_id, name: req.user.company };
      departmentRow = await getOrCreateDepartment(companyRow.id, department);
    } else {
      companyRow = { id: req.user.company_id, name: req.user.company };
      departmentRow = { id: req.user.department_id, name: req.user.department };
    }

    let responsibleUser = null;
    if (responsible_user_id) {
      responsibleUser = await get('SELECT * FROM users WHERE id = ? AND is_master = 0', responsible_user_id);
      if (!responsibleUser) {
        return res.status(400).json({ error: 'responsible person must be an existing Drive user' });
      }
    }

    const result = await run(
      `INSERT INTO projects (name, description, status, company, department, company_id, department_id, responsible_person, responsible_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name.trim(),
      description,
      status,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id,
      responsibleUser ? displayName(responsibleUser) : '',
      responsibleUser ? responsibleUser.id : null
    );
    const project = await get('SELECT * FROM projects WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// Every non-master user in Drive, for pickers that run before a project
// exists yet (e.g. the "Responsible Person" dropdown on the New Project
// form). Registered before the `/:id` routes below so "assignable-users"
// isn't swallowed as an :id value.
router.get('/assignable-users', async (req, res, next) => {
  try {
    const filter = assignableUsersFilter(req);
    const users = await all(
      `SELECT id, email, first_name, last_name, role FROM users
       WHERE is_master = 0
       ${filter.sql}
       ORDER BY email ASC`,
      ...filter.params
    );
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await get(
      `SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects WHERE id = ?`,
      req.params.id
    );
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }

    const { name, description, status, responsible_user_id } = req.body;
    if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
    }

    let responsiblePersonText = project.responsible_person;
    let newResponsibleUserId = project.responsible_user_id;
    if (responsible_user_id !== undefined) {
      if (responsible_user_id === null) {
        newResponsibleUserId = null;
        responsiblePersonText = '';
      } else {
        const responsibleUser = await get('SELECT * FROM users WHERE id = ? AND is_master = 0', responsible_user_id);
        if (!responsibleUser) {
          return res.status(400).json({ error: 'responsible person must be an existing Drive user' });
        }
        newResponsibleUserId = responsibleUser.id;
        responsiblePersonText = displayName(responsibleUser);
      }
    }

    // Track when a project actually finished (for TAT reporting), separate from
    // updated_at which changes on any edit. Re-opening a completed project
    // clears it, so re-completing it later records a fresh completion date.
    let completedAt = project.completed_at;
    if (status !== undefined && status !== project.status) {
      completedAt = status === 'completed' ? new Date().toISOString() : null;
    }

    await run(
      `UPDATE projects SET
        name = ?, description = ?, status = ?, responsible_person = ?, responsible_user_id = ?,
        completed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      name !== undefined ? name : project.name,
      description !== undefined ? description : project.description,
      status !== undefined ? status : project.status,
      responsiblePersonText,
      newResponsibleUserId,
      completedAt,
      req.params.id
    );

    res.json(
      await get(`SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects WHERE id = ?`, req.params.id)
    );
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    await run('DELETE FROM projects WHERE id = ?', req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:id/milestones', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const milestones = await all(
      'SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order ASC, id ASC',
      req.params.id
    );
    res.json(milestones);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/milestones', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }

    const { title, due_date = null, sort_order = 0 } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const result = await run(
      'INSERT INTO milestones (project_id, title, due_date, original_due_date, sort_order) VALUES (?, ?, ?, ?, ?)',
      req.params.id,
      title.trim(),
      due_date,
      due_date,
      sort_order
    );
    res.status(201).json(await get('SELECT * FROM milestones WHERE id = ?', result.lastInsertRowid));
  } catch (err) {
    next(err);
  }
});

// Task assignment must go to someone with a real Drive account (so we can
// actually email them) — any account in Drive is eligible, not just ones in
// the project's own company/department, so a project can pull in people
// from anywhere in the org. The master account is excluded.
router.get('/:id/assignable-users', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }

    const filter = assignableUsersFilter(req);
    const users = await all(
      `SELECT id, email, first_name, last_name, role FROM users
       WHERE is_master = 0
       ${filter.sql}
       ORDER BY email ASC`,
      ...filter.params
    );
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/tasks', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const tasks = await all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', req.params.id);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

const TASK_STATUSES = ['todo', 'in_progress', 'done'];

router.post('/:id/tasks', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }

    const {
      title,
      description = '',
      status = 'todo',
      due_date = null,
      milestone_id = null,
      assignee_user_id = null,
    } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
    }

    let assigneeUser = null;
    if (assignee_user_id) {
      assigneeUser = await get('SELECT * FROM users WHERE id = ? AND is_master = 0', assignee_user_id);
      if (!assigneeUser) {
        return res.status(400).json({ error: 'assignee must be an existing Drive user' });
      }
    }

    const result = await run(
      `INSERT INTO tasks (project_id, milestone_id, title, description, assignee, assignee_user_id, status, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.params.id,
      milestone_id,
      title.trim(),
      description,
      assigneeUser ? displayName(assigneeUser) : '',
      assigneeUser ? assigneeUser.id : null,
      status,
      due_date
    );
    const task = await get('SELECT * FROM tasks WHERE id = ?', result.lastInsertRowid);
    if (assigneeUser) sendTaskAssignedEmail(assigneeUser.email, task, project);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// Plan documents: every uploaded version is kept (never overwritten), newest
// first, so the most recent one is always the current/"final" plan while
// earlier revisions stay available for reference. Uploading is Admin+Super
// Admin, same as everything else on a project; deleting an old version is
// Super Admin only, mirroring the milestone edit/delete split.
router.get('/:id/plans', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const plans = await all(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM project_plans WHERE project_id = ? ORDER BY id DESC`,
      req.params.id
    );
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/plans', canEdit, (req, res, next) => {
  planUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const result = await run(
      `INSERT INTO project_plans (project_id, filename, mime_type, size_bytes, data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.params.id,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
      displayName(req.user)
    );
    const plan = await get(
      `SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
       FROM project_plans WHERE id = ?`,
      result.lastInsertRowid
    );
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/plans/:planId/download', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const plan = await get(
      'SELECT * FROM project_plans WHERE id = ? AND project_id = ?',
      req.params.planId,
      req.params.id
    );
    if (!plan) return res.status(404).json({ error: 'plan not found' });
    res.set('Content-Type', plan.mime_type);
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(plan.filename)}"`);
    res.send(Buffer.from(plan.data));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/plans/:planId', superAdminOnly, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const plan = await get(
      'SELECT id FROM project_plans WHERE id = ? AND project_id = ?',
      req.params.planId,
      req.params.id
    );
    if (!plan) return res.status(404).json({ error: 'plan not found' });
    await run('DELETE FROM project_plans WHERE id = ?', req.params.planId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Project rollout date: every entry ever set is kept (nothing is ever
// deleted or overwritten), newest first — a full audit trail of when the
// rollout was originally planned and every time it got pushed. Setting the
// very first one is Admin+Super Admin, same as everything else on a
// project; adding a revision once one already exists is Super Admin only.
router.get('/:id/rollout-dates', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const rolloutDates = await all(
      'SELECT * FROM project_rollout_dates WHERE project_id = ? ORDER BY id DESC',
      req.params.id
    );
    res.json(rolloutDates);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/rollout-dates', canEdit, async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }

    const { rollout_date } = req.body;
    if (!rollout_date) {
      return res.status(400).json({ error: 'rollout_date is required' });
    }

    const latest = await get(
      'SELECT id FROM project_rollout_dates WHERE project_id = ? ORDER BY id DESC LIMIT 1',
      req.params.id
    );
    if (latest && !['super_admin', 'pro_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'only Super Admin can revise an already-set rollout date' });
    }

    const result = await run(
      'INSERT INTO project_rollout_dates (project_id, rollout_date, set_by) VALUES (?, ?, ?)',
      req.params.id,
      rollout_date,
      displayName(req.user)
    );
    const row = await get('SELECT * FROM project_rollout_dates WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

export default router;
