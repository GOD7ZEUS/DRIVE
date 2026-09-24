import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { formatUserName } from '../userDisplay.js';
import { formatDate, formatDateTime } from '../dateFormat.js';

const TASK_STATUSES = ['todo', 'in_progress', 'done'];

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user.role !== 'view';
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState('');

  const attachmentFileInputRef = useRef(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [editing, setEditing] = useState(false);

  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentBody, setCommentBody] = useState('');

  function load() {
    Promise.all([api.getTask(id), api.getComments(id), api.getTaskAttachments(id)])
      .then(([t, c, a]) => {
        setTask(t);
        setComments(c);
        setAttachments(a);
        setTitle(t.title);
        setDescription(t.description || '');
        setAssigneeUserId(t.assignee_user_id || '');
        setDueDate(t.due_date || '');
        api.getAssignableUsers(t.project_id).then(setAssignableUsers).catch(() => setAssignableUsers([]));
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
    await api.updateTask(id, {
      title,
      description,
      assignee_user_id: assigneeUserId || null,
      due_date: dueDate || null,
    });
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

  async function handleAttachmentFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAttachmentError('');
    setUploadingAttachment(true);
    try {
      await api.uploadTaskAttachment(id, file);
      load();
    } catch (err) {
      setAttachmentError(err.message);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleDeleteAttachment(a) {
    if (!confirm(`Delete file "${a.filename}"? This cannot be undone.`)) return;
    await api.deleteTaskAttachment(id, a.id);
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
            {task.due_date && <span>Due {formatDate(task.due_date)}</span>}
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
            <select value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserName(u)}
                </option>
              ))}
            </select>
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
        <div className="row-between">
          <h2>Files</h2>
          {canEdit && (
            <>
              <input
                ref={attachmentFileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                style={{ display: 'none' }}
                onChange={handleAttachmentFileSelected}
              />
              <button onClick={() => attachmentFileInputRef.current?.click()} disabled={uploadingAttachment}>
                {uploadingAttachment ? 'Uploading…' : 'Upload File'}
              </button>
            </>
          )}
        </div>

        <p className="muted" style={{ marginBottom: 12 }}>
          PDF, PNG, or JPG, up to 500 KB each. Attach as many as the task needs.
        </p>
        {attachmentError && <p className="error">{attachmentError}</p>}

        {attachments.length === 0 ? (
          <p className="muted">No files uploaded yet.</p>
        ) : (
          <div className="list">
            {attachments.map((a) => (
              <div key={a.id} className="list-item">
                <div>
                  <div className="title">{a.filename}</div>
                  <div className="muted">
                    {formatFileSize(a.size_bytes)}
                    {a.uploaded_by ? ` · Uploaded by ${a.uploaded_by}` : ''} · {formatDateTime(a.created_at)}
                  </div>
                </div>
                <div className="row">
                  <a href={api.getTaskAttachmentDownloadUrl(id, a.id)} target="_blank" rel="noreferrer">
                    <button type="button">View</button>
                  </a>
                  {canEdit && (
                    <button className="danger" onClick={() => handleDeleteAttachment(a)}>
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
                  {c.author || 'anonymous'} · {formatDateTime(c.created_at)}
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
