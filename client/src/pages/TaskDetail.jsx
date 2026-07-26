import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const TASK_STATUSES = ['todo', 'in_progress', 'done'];

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user.role !== 'view';
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [editing, setEditing] = useState(false);

  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentBody, setCommentBody] = useState('');

  function load() {
    Promise.all([api.getTask(id), api.getComments(id)])
      .then(([t, c]) => {
        setTask(t);
        setComments(c);
        setTitle(t.title);
        setDescription(t.description || '');
        setAssignee(t.assignee || '');
        setDueDate(t.due_date || '');
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleStatusChange(status) {
    await api.updateTask(id, { status });
    load();
  }

  async function handleSaveEdits(e) {
    e.preventDefault();
    await api.updateTask(id, { title, description, assignee, due_date: dueDate || null });
    setEditing(false);
    load();
  }

  async function handleDelete() {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    await api.deleteTask(id);
    navigate(`/projects/${task.project_id}`);
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    await api.createComment(id, { author: commentAuthor, body: commentBody });
    setCommentBody('');
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!task) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="breadcrumb muted">
        <Link to={`/projects/${task.project_id}`}>← Back to project</Link>
      </div>

      {!editing ? (
        <>
          <div className="row-between">
            <h1>{task.title}</h1>
            {canEdit && (
              <div className="row">
                <select value={task.status} onChange={(e) => handleStatusChange(e.target.value)}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button onClick={() => setEditing(true)}>Edit</button>
                <button className="danger" onClick={handleDelete}>
                  Delete
                </button>
              </div>
            )}
          </div>
          <div className="row muted" style={{ marginBottom: 12 }}>
            <StatusBadge status={task.status} />
            {task.assignee && <span>Assigned to {task.assignee}</span>}
            {task.due_date && <span>Due {task.due_date}</span>}
          </div>
          {task.description && <p>{task.description}</p>}
        </>
      ) : (
        <form className="panel form-grid" onSubmit={handleSaveEdits} style={{ marginBottom: 20 }}>
          <label>
            Title
            <br />
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Description
            <br />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label>
            Assignee
            <br />
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          </label>
          <label>
            Due date
            <br />
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit" className="primary">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="section">
        <h2>Activity & Comments</h2>
        {canEdit && (
          <form className="inline-form panel" onSubmit={handleAddComment} style={{ marginBottom: 12 }}>
            <input
              placeholder="Your name"
              value={commentAuthor}
              onChange={(e) => setCommentAuthor(e.target.value)}
              style={{ maxWidth: 140 }}
            />
            <input
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
              required
            />
            <button type="submit" className="primary">
              Post
            </button>
          </form>
        )}

        {comments.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <div className="list">
            {comments.map((c) => (
              <div key={c.id} className="comment">
                <div className="comment-meta">
                  {c.author || 'anonymous'} · {c.created_at}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
