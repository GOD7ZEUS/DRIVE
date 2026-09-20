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
};

const ACTION_LABELS = {
  deleted: '🗑️ Deleted',
  updated: '✏️ Edited',
};

export default function ActivityLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAuditLog().then(setEntries).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Activity Log</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Every delete and edit across Drive — visible only to the master account.
      </p>

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
            </div>
            <div className="muted">{formatDateTime(e.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
