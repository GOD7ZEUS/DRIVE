import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatUserName } from '../userDisplay.js';
import { formatDate, formatDateTime } from '../dateFormat.js';

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user.role !== 'view';
  const isSuperAdmin = user.role === 'super_admin';
  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [rolloutDates, setRolloutDates] = useState([]);
  const [error, setError] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');

  const planFileInputRef = useRef(null);
  const [uploadingPlan, setUploadingPlan] = useState(false);
  const [planError, setPlanError] = useState('');

  const [showRolloutForm, setShowRolloutForm] = useState(false);
  const [newRolloutDate, setNewRolloutDate] = useState('');
  const [rolloutError, setRolloutError] = useState('');
  const [savingRollout, setSavingRollout] = useState(false);

  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDue, setMilestoneDue] = useState('');
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [editMilestoneTitle, setEditMilestoneTitle] = useState('');
  const [editMilestoneDue, setEditMilestoneDue] = useState('');

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssigneeUserId, setTaskAssigneeUserId] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskMilestone, setTaskMilestone] = useState('');

  function load() {
    Promise.all([
      api.getProject(id),
      api.getMilestones(id),
      api.getProjectTasks(id),
      api.getAssignableUsers(id),
      api.getPlans(id),
      api.getRolloutDates(id),
    ])
      .then(([p, m, t, u, pl, rd]) => {
        setProject(p);
        setMilestones(m);
        setTasks(t);
        setAssignableUsers(u);
        setPlans(pl);
        setRolloutDates(rd);
        setResponsibleUserId(p.responsible_user_id || '');
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleStatusChange(status) {
    await api.updateProject(id, { status });
    load();
  }

  async function handleResponsibleUserChange(e) {
    const value = e.target.value;
    setResponsibleUserId(value);
    await api.updateProject(id, { responsible_user_id: value || null });
    load();
  }

  async function handleDeleteProject() {
    if (!confirm(`Delete project "${project.name}"? This also deletes its milestones and tasks.`)) return;
    await api.deleteProject(id);
    navigate('/projects');
  }

  async function handleAddMilestone(e) {
    e.preventDefault();
    if (!milestoneTitle.trim()) return;
    await api.createMilestone(id, { title: milestoneTitle, due_date: milestoneDue || null });
    setMilestoneTitle('');
    setMilestoneDue('');
    setShowMilestoneForm(false);
    load();
  }

  async function toggleMilestoneDone(m) {
    await api.updateMilestone(m.id, { status: m.status === 'done' ? 'pending' : 'done' });
    load();
  }

  function startEditMilestone(m) {
    setEditingMilestoneId(m.id);
    setEditMilestoneTitle(m.title);
    setEditMilestoneDue(m.due_date || '');
  }

  async function handleSaveMilestoneEdit(e) {
    e.preventDefault();
    await api.updateMilestone(editingMilestoneId, {
      title: editMilestoneTitle,
      due_date: editMilestoneDue || null,
    });
    setEditingMilestoneId(null);
    load();
  }

  async function handleDeleteMilestone(m) {
    if (!confirm(`Delete milestone "${m.title}"? Its tasks will become unassigned from it.`)) return;
    await api.deleteMilestone(m.id);
    load();
  }

  async function handleAddTask(e) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    await api.createTask(id, {
      title: taskTitle,
      assignee_user_id: taskAssigneeUserId || null,
      due_date: taskDue || null,
      milestone_id: taskMilestone || null,
    });
    setTaskTitle('');
    setTaskAssigneeUserId('');
    setTaskDue('');
    setTaskMilestone('');
    setShowTaskForm(false);
    load();
  }

  async function handlePlanFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPlanError('');
    setUploadingPlan(true);
    try {
      await api.uploadPlan(id, file);
      load();
    } catch (err) {
      setPlanError(err.message);
    } finally {
      setUploadingPlan(false);
    }
  }

  async function handleDeletePlan(p) {
    if (!confirm(`Delete plan "${p.filename}"? This cannot be undone.`)) return;
    await api.deletePlan(id, p.id);
    load();
  }

  async function handleAddRolloutDate(e) {
    e.preventDefault();
    if (!newRolloutDate) return;
    setRolloutError('');
    setSavingRollout(true);
    try {
      await api.addRolloutDate(id, newRolloutDate);
      setNewRolloutDate('');
      setShowRolloutForm(false);
      load();
    } catch (err) {
      setRolloutError(err.message);
    } finally {
      setSavingRollout(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Loading…</p>;

  const visibleTasks = taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter);
  // rolloutDates is newest-first, so the earliest (baseline) entry is the
  // last one in the array — TAT is measured against that, not whatever the
  // rollout date has since been revised to.
  const tatDeadline = rolloutDates.length > 0 ? rolloutDates[rolloutDates.length - 1].rollout_date : null;

  return (
    <div>
      <div className="breadcrumb muted">
        <Link to="/projects">← All projects</Link>
      </div>

      <div className="row-between">
        <div>
          <h1>{project.name}</h1>
          {rolloutDates.length > 0 && <h1>Rollout Date - {formatDate(rolloutDates[0].rollout_date)}</h1>}
        </div>
        <div className="row">
          <button onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? 'Hide Details' : canEdit ? 'Edit' : 'View Details'}
          </button>
          {canEdit && (
            <button className="danger" onClick={handleDeleteProject}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="row-between" style={{ marginBottom: 16 }}>
        <div className="muted">
          Owner:{' '}
          {canEdit ? (
            <select
              value={responsibleUserId}
              onChange={handleResponsibleUserChange}
              style={{ display: 'inline-block', width: 'auto' }}
            >
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserName(u)}
                </option>
              ))}
            </select>
          ) : (
            project.responsible_person || 'Unassigned'
          )}
        </div>
        <div className="muted">Last updated {formatDateTime(project.updated_at)}</div>
      </div>

      {showDetails && (
      <>
      <table className="detail-table">
        <tbody>
          <tr>
            <th>Status</th>
            <td>
              {canEdit ? (
                <select value={project.status} onChange={(e) => handleStatusChange(e.target.value)}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={project.status} />
              )}
            </td>
          </tr>
          {project.completed_at && (
            <tr>
              <th>Completed</th>
              <td>
                {formatDate(project.completed_at)}
                {tatDeadline && (
                  <span className="muted">
                    {' '}
                    ·{' '}
                    {project.completed_at.slice(0, 10) <= tatDeadline ? 'within TAT' : 'exceeded TAT'}
                  </span>
                )}
              </td>
            </tr>
          )}
          <tr>
            <th>Company</th>
            <td>
              {project.company ? (
                <>
                  {project.company} <span className="key-tag">Co.{project.company_id}</span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Department</th>
            <td>
              {project.department ? (
                <>
                  {project.department} <span className="key-tag">Dept.{project.department_id}</span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Description</th>
            <td>{project.description || <span className="muted">No description</span>}</td>
          </tr>
          <tr>
            <th>Created</th>
            <td>{formatDateTime(project.created_at)}</td>
          </tr>
        </tbody>
      </table>

      <div className="section">
        <div className="row-between">
          <h2>Rollout Date History</h2>
          {(rolloutDates.length === 0 ? canEdit : isSuperAdmin) && (
            <button onClick={() => setShowRolloutForm((s) => !s)}>
              {showRolloutForm ? 'Cancel' : rolloutDates.length === 0 ? 'Set Rollout Date' : 'Revise Rollout Date'}
            </button>
          )}
        </div>

        {showRolloutForm && (
          <form className="inline-form panel" onSubmit={handleAddRolloutDate} style={{ marginBottom: 12 }}>
            <input
              type="date"
              value={newRolloutDate}
              onChange={(e) => setNewRolloutDate(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" className="primary" disabled={savingRollout}>
              Save
            </button>
          </form>
        )}
        {rolloutError && <p className="error">{rolloutError}</p>}

        {rolloutDates.length === 0 ? (
          <p className="muted">No rollout date set yet.</p>
        ) : (
          <div className="list">
            {rolloutDates.map((r, i) => (
              <div key={r.id} className="list-item">
                <div>
                  <div className="title">
                    {formatDate(r.rollout_date)} {i === 0 && <span className="key-tag">CURRENT</span>}
                  </div>
                  <div className="muted">
                    Set by {r.set_by || 'unknown'} · {formatDateTime(r.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      <div className="section">
        <div className="row-between">
          <h2>Plan Documents</h2>
          {canEdit && (
            <>
              <input
                ref={planFileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                style={{ display: 'none' }}
                onChange={handlePlanFileSelected}
              />
              <button onClick={() => planFileInputRef.current?.click()} disabled={uploadingPlan}>
                {uploadingPlan ? 'Uploading…' : 'Upload New Plan'}
              </button>
            </>
          )}
        </div>

        <p className="muted" style={{ marginBottom: 12 }}>
          PDF, PNG, or JPG, up to 5 MB. The most recent upload is the final plan — every earlier version
          stays available below it.
        </p>
        {planError && <p className="error">{planError}</p>}

        {plans.length === 0 ? (
          <p className="muted">No plan documents uploaded yet.</p>
        ) : (
          <div className="list">
            {plans.map((p, i) => (
              <div key={p.id} className="list-item">
                <div>
                  <div className="title">
                    {p.filename} {i === 0 && <span className="key-tag">FINAL</span>}
                  </div>
                  <div className="muted">
                    {formatFileSize(p.size_bytes)}
                    {p.uploaded_by ? ` · Uploaded by ${p.uploaded_by}` : ''} · {formatDateTime(p.created_at)}
                  </div>
                </div>
                <div className="row">
                  <button type="button" onClick={() => window.open(api.getPlanDownloadUrl(id, p.id), '_blank')}>
                    View
                  </button>
                  {isSuperAdmin && (
                    <button className="danger" onClick={() => handleDeletePlan(p)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="row-between">
          <h2>Milestones</h2>
          {canEdit && (
            <button onClick={() => setShowMilestoneForm((s) => !s)}>
              {showMilestoneForm ? 'Cancel' : 'Add Milestone'}
            </button>
          )}
        </div>

        {canEdit && showMilestoneForm && (
          <form className="inline-form panel" onSubmit={handleAddMilestone} style={{ marginBottom: 12 }}>
            <input
              placeholder="Milestone title"
              value={milestoneTitle}
              onChange={(e) => setMilestoneTitle(e.target.value)}
              required
              autoFocus
            />
            <input type="date" value={milestoneDue} onChange={(e) => setMilestoneDue(e.target.value)} />
            <button type="submit" className="primary">
              Add
            </button>
          </form>
        )}

        {milestones.length === 0 ? (
          <p className="muted">No milestones yet.</p>
        ) : (
          <div className="list">
            {milestones.map((m) => {
              const milestoneTasks = tasks.filter((t) => t.milestone_id === m.id);
              return (
                <div key={m.id} className="milestone-block">
                  {editingMilestoneId === m.id ? (
                    <form
                      className="inline-form panel"
                      onSubmit={handleSaveMilestoneEdit}
                      style={{ marginBottom: 8 }}
                    >
                      <input
                        value={editMilestoneTitle}
                        onChange={(e) => setEditMilestoneTitle(e.target.value)}
                        required
                        autoFocus
                      />
                      <input
                        type="date"
                        value={editMilestoneDue}
                        onChange={(e) => setEditMilestoneDue(e.target.value)}
                      />
                      <button type="submit" className="primary">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingMilestoneId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="list-item">
                      <div>
                        <div className="title">{m.title}</div>
                        {m.due_date && (
                          <div className="muted">
                            {m.original_due_date && m.original_due_date !== m.due_date
                              ? `Originally due ${formatDate(m.original_due_date)} · revised to ${formatDate(m.due_date)}`
                              : `Due ${formatDate(m.due_date)}`}
                          </div>
                        )}
                      </div>
                      <div className="row">
                        <StatusBadge status={m.status} />
                        {canEdit && (
                          <button onClick={() => toggleMilestoneDone(m)}>
                            {m.status === 'done' ? 'Reopen' : 'Mark done'}
                          </button>
                        )}
                        {isSuperAdmin && (
                          <>
                            <button onClick={() => startEditMilestone(m)}>Edit</button>
                            <button className="danger" onClick={() => handleDeleteMilestone(m)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {milestoneTasks.length > 0 && (
                    <div className="milestone-tasks">
                      {milestoneTasks.map((t) => (
                        <Link key={t.id} to={`/tasks/${t.id}`} className="list-item nested">
                          <div>
                            <div className="title">{t.title}</div>
                            <div className="muted">
                              {t.assignee ? `${t.assignee} · ` : ''}
                              {t.due_date ? `due ${formatDate(t.due_date)}` : 'no due date'}
                            </div>
                          </div>
                          <StatusBadge status={t.status} />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="section">
        <div className="row-between">
          <h2>Tasks</h2>
          <div className="row">
            <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {canEdit && (
              <button onClick={() => setShowTaskForm((s) => !s)}>{showTaskForm ? 'Cancel' : 'Add Task'}</button>
            )}
          </div>
        </div>

        {canEdit && showTaskForm && (
          <form className="inline-form panel" onSubmit={handleAddTask} style={{ marginBottom: 12 }}>
            <input
              placeholder="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
              autoFocus
            />
            <select value={taskAssigneeUserId} onChange={(e) => setTaskAssigneeUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserName(u)}
                </option>
              ))}
            </select>
            <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
            <select value={taskMilestone} onChange={(e) => setTaskMilestone(e.target.value)}>
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
            <button type="submit" className="primary">
              Add
            </button>
          </form>
        )}

        {visibleTasks.length === 0 ? (
          <p className="muted">No tasks.</p>
        ) : (
          <div className="list">
            {visibleTasks.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="list-item">
                <div>
                  <div className="title">{t.title}</div>
                  <div className="muted">
                    {t.assignee ? `${t.assignee} · ` : ''}
                    {t.due_date ? `due ${formatDate(t.due_date)}` : 'no due date'}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
