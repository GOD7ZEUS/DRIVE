import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime } from '../dateFormat.js';

const ENTITY_LABELS = {
  project: 'Project',
  task: 'Task',
  milestone: 'Milestone',
  user: 'User',
  company: 'Company',
  department: 'Department',
  'plan document': 'Plan Document',
  'task attachment': 'Task File',
  'milestone attachment': 'Milestone File',
};

const ACTION_LABELS = {
  deleted: '🗑️ Deleted',
  updated: '✏️ Edited',
  restored: '↩️ Restored',
};

export default function ActivityLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState(null);
  const [restoreError, setRestoreError] = useState({});

  function load() {
    api.getAuditLog().then(setEntries).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function handleRestore(e) {
    if (!confirm(`Restore this ${ENTITY_LABELS[e.entity_type] || e.entity_type} to its state before this ${e.action}?`)) {
      return;
    }
    setRestoringId(e.id);
    setRestoreError((prev) => ({ ...prev, [e.id]: '' }));
    try {
      await api.restoreAuditLogEntry(e.id);
      load();
    } catch (err) {
      setRestoreError((prev) => ({ ...prev, [e.id]: err.message }));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div>
      <h1>Activity Log</h1>

      {error && <p className="error">{error}</p>}
      {!entries && !error && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted">No activity recorded yet.</p>}

      <div className="list">
        {entries?.map((e) => (
          <div key={e.id} className="list-item">
            <div>
              <div className="title">
                {ACTION_LABELS[e.action] || e.action} {ENTITY_LABELS[e.entity_type] || e.entity_type}
                {e.entity_name ? ` "${e.entity_name}"` : ''}
              </div>
              <div className="muted">
                by {e.actor_name}
                {e.details ? ` · ${e.details}` : ''}
              </div>
              {restoreError[e.id] && <p className="error">{restoreError[e.id]}</p>}
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              {e.restorable && (
                <button type="button" onClick={() => handleRestore(e)} disabled={restoringId === e.id}>
                  {restoringId === e.id ? 'Restoring…' : 'Restore'}
                </button>
              )}
              <div className="muted">{formatDateTime(e.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
