import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user.role !== 'view';
  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');

  const [responsiblePerson, setResponsiblePerson] = useState('');
  const [deadline, setDeadline] = useState('');

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDue, setMilestoneDue] = useState('');

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskMilestone, setTaskMilestone] = useState('');

  function load() {
    Promise.all([api.getProject(id), api.getMilestones(id), api.getProjectTasks(id)])
      .then(([p, m, t]) => {
        setProject(p);
        setMilestones(m);
        setTasks(t);
        setResponsiblePerson(p.responsible_person || '');
        setDeadline(p.deadline || '');
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleStatusChange(status) {
    await api.updateProject(id, { status });
    load();
  }

  async function handleResponsiblePersonBlur() {
    if (responsiblePerson !== (project.responsible_person || '')) {
      await api.updateProject(id, { responsible_person: responsiblePerson });
      load();
    }
  }

  async function handleDeadlineChange(e) {
    const value = e.target.value;
    setDeadline(value);
    await api.updateProject(id, { deadline: value || null });
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

  async function handleAddTask(e) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    await api.createTask(id, {
      title: taskTitle,
      assignee: taskAssignee,
      due_date: taskDue || null,
      milestone_id: taskMilestone || null,
    });
    setTaskTitle('');
    setTaskAssignee('');
    setTaskDue('');
    setTaskMilestone('');
    setShowTaskForm(false);
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Loading…</p>;

  const visibleTasks = taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter);

  return (
    <div>
      <div className="breadcrumb muted">
        <Link to="/projects">← All projects</Link>
      </div>

      <div className="row-between">
        <h1>{project.name}</h1>
        {canEdit && (
          <button className="danger" onClick={handleDeleteProject}>
            Delete
          </button>
        )}
      </div>

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
          <tr>
            <th>Responsible Person</th>
            <td>
              {canEdit ? (
                <input
                  value={responsiblePerson}
                  placeholder="Unassigned"
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  onBlur={handleResponsiblePersonBlur}
                />
              ) : (
                project.responsible_person || <span className="muted">Unassigned</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Deadline</th>
            <td>
              {canEdit ? (
                <input type="date" value={deadline} onChange={handleDeadlineChange} />
              ) : (
                project.deadline || <span className="muted">No deadline</span>
              )}
            </td>
          </tr>
          {project.completed_at && (
            <tr>
              <th>Completed</th>
              <td>
                {project.completed_at.slice(0, 10)}
                {project.deadline && (
                  <span className="muted">
                    {' '}
                    ·{' '}
                    {project.completed_at.slice(0, 10) <= project.deadline
                      ? 'within TAT'
                      : 'exceeded TAT'}
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
            <td>{project.created_at}</td>
          </tr>
          <tr>
            <th>Last Updated</th>
            <td>{project.updated_at}</td>
          </tr>
        </tbody>
      </table>

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
            {milestones.map((m) => (
              <div key={m.id} className="list-item">
                <div>
                  <div className="title">{m.title}</div>
                  {m.due_date && <div className="muted">Due {m.due_date}</div>}
                </div>
                <div className="row">
                  <StatusBadge status={m.status} />
                  {canEdit && (
                    <button onClick={() => toggleMilestoneDone(m)}>
                      {m.status === 'done' ? 'Reopen' : 'Mark done'}
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
            <input
              placeholder="Assignee"
              value={taskAssignee}
              onChange={(e) => setTaskAssignee(e.target.value)}
            />
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
                    {t.due_date ? `due ${t.due_date}` : 'no due date'}
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
