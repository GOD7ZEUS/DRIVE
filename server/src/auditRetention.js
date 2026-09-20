import { run } from './db.js';

// Entries older than this are pruned automatically — the log is meant for
// recent accountability, not an indefinite archive.
const RETENTION_DAYS = 30;

export async function pruneAuditLog() {
  const result = await run(`DELETE FROM audit_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`);
  return result.changes;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Same resilience-to-downtime shape as the task reminder sweep: runs once
// immediately (so a server that was asleep still catches up), then on a
// recurring interval rather than relying on the exact moment an entry turns
// 30 days old.
export function startAuditLogRetentionSchedule() {
  pruneAuditLog().catch((err) => console.error('Audit log retention sweep failed:', err.message));
  setInterval(() => {
    pruneAuditLog().catch((err) => console.error('Audit log retention sweep failed:', err.message));
  }, CHECK_INTERVAL_MS);
}
