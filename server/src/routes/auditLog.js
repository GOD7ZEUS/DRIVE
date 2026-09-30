import { Router } from 'express';
import { get, all, run, logAudit } from '../db.js';
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

function reinsertRow(tableName, row) {
  const keys = Object.keys(row);
  const columns = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  return run(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, ...keys.map((k) => row[k]));
}

function revertToSnapshot(tableName, before) {
  const { id, ...fields } = before;
  const keys = Object.keys(fields);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  return run(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
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

    try {
      if (entry.action === 'updated') {
        await revertToSnapshot(tableName, snapshot.before);
      } else if (entry.entity_type === 'project') {
        await reinsertRow('projects', snapshot.row);
        for (const m of snapshot.milestones ?? []) await reinsertRow('milestones', m);
        for (const t of snapshot.tasks ?? []) await reinsertRow('tasks', t);
        for (const c of snapshot.comments ?? []) await reinsertRow('comments', c);
        for (const r of snapshot.rolloutDates ?? []) await reinsertRow('project_rollout_dates', r);
      } else if (entry.entity_type === 'milestone') {
        await reinsertRow('milestones', snapshot.row);
        for (const taskId of snapshot.linkedTaskIds ?? []) {
          await run('UPDATE tasks SET milestone_id = ? WHERE id = ? AND milestone_id IS NULL', snapshot.row.id, taskId);
        }
      } else if (entry.entity_type === 'task') {
        await reinsertRow('tasks', snapshot.row);
        for (const c of snapshot.comments ?? []) await reinsertRow('comments', c);
      } else {
        await reinsertRow(tableName, snapshot.row);
      }
    } catch (err) {
      // A unique-constraint collision (e.g. a new user/company already took
      // the old email/name) is the one realistic failure mode here — surface
      // it plainly instead of a raw 500.
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'cannot restore — something with the same unique name/email already exists',
        });
      }
      throw err;
    }

    await run('UPDATE audit_log SET restored_at = datetime(\'now\') WHERE id = ?', entry.id);
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
