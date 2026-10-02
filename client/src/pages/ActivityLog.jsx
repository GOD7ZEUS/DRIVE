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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

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

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function runRemoval(removeFn) {
    setRemoving(true);
    setRemoveError('');
    try {
      await removeFn();
      stopSelecting();
      load();
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  function handleRemoveSelected() {
    const count = selected.size;
    if (!count) return;
    if (!confirm(`Remove ${count} ${count === 1 ? 'entry' : 'entries'} from the Activity Log? Removed entries can't be restored.`)) {
      return;
    }
    runRemoval(() => api.removeAuditLogEntries([...selected]));
  }

  function handleRemoveAll() {
    if (!confirm("Remove every entry from the Activity Log? This can't be undone, and nothing in it can be restored afterwards.")) {
      return;
    }
    runRemoval(() => api.removeAllAuditLogEntries());
  }

  const hasEntries = entries && entries.length > 0;
  const allSelected = hasEntries && selected.size === entries.length;

  return (
    <div>
      <div className="row-between activity-log-header">
        <h1>Activity Log</h1>
        {hasEntries && (
          <div className="row">
            {selecting ? (
              <>
                <label className="activity-select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)))}
                  />
                  Select all
                </label>
                <button type="button" className="danger" onClick={handleRemoveSelected} disabled={removing || selected.size === 0}>
                  {removing ? 'Removing…' : `Remove selected (${selected.size})`}
                </button>
                <button type="button" onClick={stopSelecting} disabled={removing}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSelecting(true)}>
                  Select
                </button>
                <button type="button" className="danger" onClick={handleRemoveAll} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove all'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {removeError && <p className="error">{removeError}</p>}
      {!entries && !error && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted">No activity recorded yet.</p>}

      <div className="list">
        {entries?.map((e) => (
          <div
            key={e.id}
            className={`list-item activity-entry${selecting ? ' selectable' : ''}${selected.has(e.id) ? ' selected' : ''}`}
            onClick={selecting ? () => toggleSelected(e.id) : undefined}
          >
            {selecting && (
              <input
                type="checkbox"
                className="activity-entry-check"
                checked={selected.has(e.id)}
                onChange={() => toggleSelected(e.id)}
                onClick={(ev) => ev.stopPropagation()}
                aria-label={`Select entry ${e.id}`}
              />
            )}
            <div className="activity-entry-info">
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
              {e.restorable && !selecting && (
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
