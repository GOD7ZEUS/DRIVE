import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import {
  get,
  all,
  run,
  getOrCreateCompany,
  getOrCreateDepartment,
  getOrCreateSubDepartment,
  displayName,
  logAudit,
  describeChanges,
} from '../db.js';
import { requireRole, matchesScope, scopeClause, blockedByPrivacy } from '../middleware/auth.js';
import { sendTaskAssignedEmail } from '../notifications.js';

const router = Router();
const canEdit = requireRole('super_admin', 'pro_admin', 'admin');
const superAdminOnly = requireRole('super_admin', 'pro_admin');

// The plan-lock password hash never leaves the server — every project
// response is scrubbed down to just a `plan_locked` boolean instead.
function stripPlanLock(project) {
  if (!project) return project;
  const { plan_lock_hash, ...rest } = project;
  return { ...rest, plan_locked: !!plan_lock_hash };
}

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
    res.json(projects.map(stripPlanLock));
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

    // Sub-department is always optional — a plain Department is still a
    // complete, valid project, exactly as before this existed.
    let subDepartmentRow = { id: null, name: null };
    if (req.body.sub_department && req.body.sub_department.trim()) {
      subDepartmentRow = await getOrCreateSubDepartment(departmentRow.id, req.body.sub_department);
    }

    const result = await run(
      `INSERT INTO projects (name, description, status, company, department, company_id, department_id, sub_department, sub_department_id, responsible_person, responsible_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name.trim(),
      description,
      status,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id,
      subDepartmentRow.name,
      subDepartmentRow.id,
      responsibleUser ? displayName(responsibleUser) : '',
      responsibleUser ? responsibleUser.id : null
    );
    const project = await get('SELECT * FROM projects WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(stripPlanLock(project));
  } catch (err) {
    next(err);
  }
});

// Sub-departments have no management page of their own — the New Project
// form (and a project's own Edit tab) are the only places they're picked or
// created, so this lookup lives here rather than under /api/companies
// (which Admin/View can't reach at all). Anyone who could plausibly be
// creating a project under this department can list its sub-departments:
// master and Super Admin see any (Super Admin still loses a private
// company), a Pro Admin only their own company's departments, and Admin/View
// only their own single department.
router.get('/departments/:deptId/sub-departments', async (req, res, next) => {
  try {
    const department = await get('SELECT * FROM departments WHERE id = ?', req.params.deptId);
    if (!department) return res.status(404).json({ error: 'department not found' });
    const company = await get('SELECT * FROM companies WHERE id = ?', department.company_id);
    if (!company) return res.status(404).json({ error: 'department not found' });

    const allowed =
      req.user.is_master ||
      req.user.role === 'super_admin' ||
      (req.user.role === 'pro_admin' && req.user.company_id === company.id) ||
      req.user.department_id === department.id;
    if (!allowed || (await blockedByPrivacy(req, department))) {
      return res.status(404).json({ error: 'department not found' });
    }

    const subDepartments = await all(
      'SELECT * FROM sub_departments WHERE department_id = ? ORDER BY name',
      req.params.deptId
    );
    res.json(subDepartments);
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
    res.json(stripPlanLock(project));
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

    const { name, description, status, responsible_user_id, company, department, sub_department } = req.body;
    if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
    }

    // Moving a project to a different company/department/sub-department is a
    // structural change — reserved for Super Admin (any company) and Pro
    // Admin (their own company only), not open to a plain Admin.
    if (
      (company !== undefined || department !== undefined || sub_department !== undefined) &&
      !['super_admin', 'pro_admin'].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "only Super Admin can change a project's department" });
    }
    // Editing the description is likewise reserved for Super Admin/Pro
    // Admin — a plain Admin can still change status/owner/etc., just not
    // rewrite what the project actually is.
    if (description !== undefined && !['super_admin', 'pro_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'only Super Admin can edit the project description' });
    }

    let companyRow = { id: project.company_id, name: project.company };
    let departmentRow = { id: project.department_id, name: project.department };
    let subDepartmentRow = { id: project.sub_department_id, name: project.sub_department };
    let departmentChanged = false;

    if (req.user.role === 'pro_admin') {
      if (department !== undefined) {
        if (!department.trim()) return res.status(400).json({ error: 'department is required' });
        companyRow = { id: req.user.company_id, name: req.user.company };
        departmentRow = await getOrCreateDepartment(companyRow.id, department);
        departmentChanged = departmentRow.id !== project.department_id;
      }
    } else if (req.user.role === 'super_admin' && (company !== undefined || department !== undefined)) {
      const companyName = company !== undefined ? company : project.company;
      const departmentName = department !== undefined ? department : project.department;
      if (!companyName || !companyName.trim() || !departmentName || !departmentName.trim()) {
        return res.status(400).json({ error: 'company and department are required' });
      }
      companyRow = await getOrCreateCompany(companyName);
      // Same guard as project creation: block attaching to a private company
      // by exact-name guess rather than silently succeeding.
      if (companyRow.is_private && !req.user.is_master) {
        return res.status(400).json({ error: 'company and department are required' });
      }
      departmentRow = await getOrCreateDepartment(companyRow.id, departmentName);
      departmentChanged = departmentRow.id !== project.department_id;
    }

    if (sub_department !== undefined) {
      subDepartmentRow =
        sub_department && sub_department.trim()
          ? await getOrCreateSubDepartment(departmentRow.id, sub_department)
          : { id: null, name: null };
    } else if (departmentChanged) {
      // The previous sub-department belongs to the old department — carrying
      // its id forward would point at a sub-department under the wrong one.
      subDepartmentRow = { id: null, name: null };
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
        company = ?, department = ?, company_id = ?, department_id = ?, sub_department = ?, sub_department_id = ?,
        completed_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      name !== undefined ? name : project.name,
      description !== undefined ? description : project.description,
      status !== undefined ? status : project.status,
      responsiblePersonText,
      newResponsibleUserId,
      companyRow.name,
      departmentRow.name,
      companyRow.id,
      departmentRow.id,
      subDepartmentRow.name,
      subDepartmentRow.id,
      completedAt,
      req.params.id
    );

    const afterValues = {
      name: name !== undefined ? name : project.name,
      description: description !== undefined ? description : project.description,
      status: status !== undefined ? status : project.status,
      responsible_person: responsiblePersonText,
      company: companyRow.name,
      department: departmentRow.name,
      sub_department: subDepartmentRow.name,
    };
    const changeSummary = describeChanges(project, afterValues, {
      name: 'name',
      description: 'description',
      status: 'status',
      responsible_person: 'owner',
      company: 'company',
      department: 'department',
      sub_department: 'sub-department',
    });
    if (changeSummary) {
      await logAudit({
        actor: req.user,
        action: 'updated',
        entityType: 'project',
        entityId: Number(req.params.id),
        entityName: afterValues.name,
        details: changeSummary,
      });
    }

    res.json(
      stripPlanLock(
        await get(`SELECT projects.*, ${CURRENT_ROLLOUT_DATE_SUBQUERY} FROM projects WHERE id = ?`, req.params.id)
      )
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
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'project',
      entityId: project.id,
      entityName: project.name,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Locking a project's plan documents behind a password is master-only —
// not even a regular Super Admin can set or change it. Everything else
// about the project (details, milestones, tasks) stays open as normal;
// only the documents themselves require the password to view/download,
// checked fresh on every request rather than granting any standing access.
router.patch('/:id/lock', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can lock or unlock a project' });
    }
    const project = await get('SELECT id, name FROM projects WHERE id = ?', req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { password } = req.body;
    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ error: 'password must be at least 4 characters' });
      }
      await run(
        'UPDATE projects SET plan_lock_hash = ? WHERE id = ?',
        bcrypt.hashSync(password, 10),
        req.params.id
      );
      await logAudit({
        actor: req.user,
        action: 'updated',
        entityType: 'project',
        entityId: project.id,
        entityName: project.name,
        details: 'locked plan documents with a password',
      });
      return res.json({ plan_locked: true });
    }
    await run('UPDATE projects SET plan_lock_hash = NULL WHERE id = ?', req.params.id);
    await logAudit({
      actor: req.user,
      action: 'updated',
      entityType: 'project',
      entityId: project.id,
      entityName: project.name,
      details: 'removed the plan documents password lock',
    });
    res.json({ plan_locked: false });
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

// A locked project's documents are never sent over a plain GET — that would
// let anyone bypass the password just by hitting the link directly. Master
// always bypasses the lock (they're the only one who can set it anyway).
router.get('/:id/plans/:planId/download', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    if (project.plan_lock_hash && !req.user.is_master) {
      return res.status(403).json({ error: 'password required', plan_locked: true });
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

// The password-gated path for a locked project's documents — verified fresh
// on every request rather than granting any standing/cached access, so
// there's nothing to expire or revoke later.
router.post('/:id/plans/:planId/download', async (req, res, next) => {
  try {
    const project = await get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!project || !matchesScope(req, project) || (await blockedByPrivacy(req, project))) {
      return res.status(404).json({ error: 'project not found' });
    }
    if (project.plan_lock_hash && !req.user.is_master) {
      const { password } = req.body;
      if (!password || !bcrypt.compareSync(password, project.plan_lock_hash)) {
        return res.status(403).json({ error: 'incorrect password' });
      }
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
      'SELECT id, filename FROM project_plans WHERE id = ? AND project_id = ?',
      req.params.planId,
      req.params.id
    );
    if (!plan) return res.status(404).json({ error: 'plan not found' });
    await run('DELETE FROM project_plans WHERE id = ?', req.params.planId);
    await logAudit({
      actor: req.user,
      action: 'deleted',
      entityType: 'plan document',
      entityId: plan.id,
      entityName: plan.filename,
      details: `from project "${project.name}"`,
    });
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
