import { Router } from 'express';
import { db, get, all, logAudit, normalizeOrgNameCase } from '../db.js';
import { pruneAuditLog } from '../auditRetention.js';

const router = Router();

// A restore only makes sense for entries that carry enough data to actually
// rebuild something (see logAudit's `snapshot` param) — plan/task/milestone
// attachment deletes never do (BLOBs are deliberately not duplicated into
// the log), so those show up in the log but are never restorable.
const RESTORE_WINDOW_DAYS = 15;
const RESTORABLE_ENTITY_TABLES = {
  project: 'projects',
  milestone: 'milestones',
  task: 'tasks',
  user: 'users',
  company: 'companies',
  department: 'departments',
};

// Who deleted or edited what, across the whole app — master account only.
// Entries older than 30 days are pruned on a schedule (see auditRetention.js)
// and, as a cheap belt-and-suspenders check, right before every read too —
// so what's shown here is never stale even between scheduled sweeps.
router.get('/', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can view the activity log' });
    }
    await pruneAuditLog();
    const entries = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500');
    const decorated = entries.map(({ snapshot, ...e }) => ({
      ...e,
      // Whether Restore should even be offered for this row — cheaper to
      // compute once here (in JS, entry-by-entry against a single "now")
      // than to repeat a per-row date comparison in every list render. The
      // raw snapshot itself (can be a full project + its milestones/tasks)
      // never needs to leave the server just to render this list.
      restorable:
        !!snapshot &&
        !e.restored_at &&
        !!RESTORABLE_ENTITY_TABLES[e.entity_type] &&
        ['updated', 'deleted'].includes(e.action) &&
        new Date(`${e.created_at.replace(' ', 'T')}Z`).getTime() >
          Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    }));
    res.json(decorated);
  } catch (err) {
    next(err);
  }
});

// Removes entries from the log for good — either the ones picked (`ids`) or
// every entry (`all: true`). Their snapshots go with them, so a removed
// entry can no longer be restored. Removals are deliberately not logged
// themselves: "Remove all" should leave the log empty.
const MAX_REMOVE_IDS = 1000;

router.post('/remove', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can remove activity log entries' });
    }
    const { ids, all: removeAll } = req.body ?? {};

    if (removeAll === true) {
      const result = await db.execute('DELETE FROM audit_log');
      return res.json({ removed: result.rowsAffected });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'pick at least one entry to remove' });
    }
    if (ids.length > MAX_REMOVE_IDS) {
      return res.status(400).json({ error: `at most ${MAX_REMOVE_IDS} entries can be removed at once` });
    }
    const cleanIds = [...new Set(ids.map(Number))];
    if (cleanIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'invalid entry id' });
    }

    const result = await db.execute({
      sql: `DELETE FROM audit_log WHERE id IN (${cleanIds.map(() => '?').join(', ')})`,
      args: cleanIds,
    });
    res.json({ removed: result.rowsAffected });
  } catch (err) {
    next(err);
  }
});

function insertStatement(tableName, row) {
  const keys = Object.keys(row);
  return {
    sql: `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    args: keys.map((k) => row[k]),
  };
}

function revertStatement(tableName, before) {
  const { id, ...fields } = before;
  const keys = Object.keys(fields);
  return {
    sql: `UPDATE ${tableName} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    args: [...keys.map((k) => fields[k]), id],
  };
}

// Maps a constraint failure from the restore batch to something actionable.
// The batch is atomic, so any of these means nothing was changed at all.
function describeRestoreFailure(err, tableName) {
  const msg = String(err.message);
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return 'cannot restore — something it depends on no longer exists (e.g. its project, company, department, or an assigned user was deleted since)';
  }
  if (msg.includes(`UNIQUE constraint failed: ${tableName}.id`)) {
    return 'cannot restore — this record already exists again (it may have been restored already)';
  }
  if (msg.includes('UNIQUE constraint failed')) {
    return 'cannot restore — something with the same unique name/email already exists';
  }
  return null;
}

router.post('/:id/restore', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can restore from the activity log' });
    }
    const entry = await get('SELECT * FROM audit_log WHERE id = ?', req.params.id);
    if (!entry) return res.status(404).json({ error: 'activity log entry not found' });
    if (entry.restored_at) {
      return res.status(400).json({ error: 'this entry has already been restored' });
    }
    const tableName = RESTORABLE_ENTITY_TABLES[entry.entity_type];
    if (!tableName || !['updated', 'deleted'].includes(entry.action) || !entry.snapshot) {
      return res.status(400).json({ error: 'this entry has nothing to restore' });
    }
    const expired = await get(
      `SELECT (? < datetime('now', '-${RESTORE_WINDOW_DAYS} days')) as expired`,
      entry.created_at
    );
    if (expired.expired) {
      return res.status(400).json({ error: `the ${RESTORE_WINDOW_DAYS}-day restore window has passed` });
    }

    const snapshot = JSON.parse(entry.snapshot);
    const statements = [];

    if (entry.action === 'updated') {
      // Reverting an edit only makes sense if the thing still exists — an
      // UPDATE against a since-deleted row would silently match nothing.
      const stillExists = await get(`SELECT id FROM ${tableName} WHERE id = ?`, snapshot.before.id);
      if (!stillExists) {
        return res.status(409).json({
          error: 'cannot revert this edit — it has since been deleted (restore the deletion first)',
        });
      }
      statements.push(revertStatement(tableName, snapshot.before));
    } else if (entry.entity_type === 'project') {
      statements.push(insertStatement('projects', snapshot.row));
      for (const m of snapshot.milestones ?? []) statements.push(insertStatement('milestones', m));
      for (const t of snapshot.tasks ?? []) statements.push(insertStatement('tasks', t));
      for (const c of snapshot.comments ?? []) statements.push(insertStatement('comments', c));
      for (const r of snapshot.rolloutDates ?? []) statements.push(insertStatement('project_rollout_dates', r));
    } else if (entry.entity_type === 'milestone') {
      statements.push(insertStatement('milestones', snapshot.row));
      for (const taskId of snapshot.linkedTaskIds ?? []) {
        statements.push({
          sql: 'UPDATE tasks SET milestone_id = ? WHERE id = ? AND milestone_id IS NULL',
          args: [snapshot.row.id, taskId],
        });
      }
    } else if (entry.entity_type === 'task') {
      statements.push(insertStatement('tasks', snapshot.row));
      for (const c of snapshot.comments ?? []) statements.push(insertStatement('comments', c));
    } else {
      statements.push(insertStatement(tableName, snapshot.row));
    }
    statements.push({
      sql: "UPDATE audit_log SET restored_at = datetime('now') WHERE id = ?",
      args: [entry.id],
    });

    // One atomic batch: a project restore is several inserts, and a failure
    // partway through (say, a task whose assigned user was deleted since)
    // must not leave a half-restored project behind.
    try {
      await db.batch(statements, 'write');
      // A snapshot taken before names were forced to capitals can bring a
      // mixed-case company/department name back with it.
      await normalizeOrgNameCase();
    } catch (err) {
      const message = describeRestoreFailure(err, tableName);
      if (message) return res.status(409).json({ error: message });
      throw err;
    }

    await logAudit({
      actor: req.user,
      action: 'restored',
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      entityName: entry.entity_name,
      details: `${entry.action} from ${entry.created_at}`,
    });

    res.status(200).json({ restored: true });
  } catch (err) {
    next(err);
  }
});

export default router;
