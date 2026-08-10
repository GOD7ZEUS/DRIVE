import { all, get, run } from './db.js';
import { sendTaskReminderEmail } from './notifications.js';

// Catches tasks due within 5 days (or already overdue) that haven't been
// reminded yet. Checking "not yet reminded" rather than "due in exactly 5
// days" makes this resilient to gaps in when the server happens to be
// awake (Render's free tier sleeps when idle) — a task due in 5 days still
// gets its reminder even if the check that would've caught it at exactly
// 5 days out never ran.
export async function sendDueReminders() {
  const dueTasks = await all(
    `SELECT tasks.*, projects.name as project_name FROM tasks
     JOIN projects ON projects.id = tasks.project_id
     WHERE tasks.due_date IS NOT NULL
       AND tasks.status != 'done'
       AND tasks.reminder_sent = 0
       AND tasks.assignee_user_id IS NOT NULL
       AND date(tasks.due_date) <= date('now', '+5 days')`
  );

  let sent = 0;
  for (const task of dueTasks) {
    const assignee = await get('SELECT * FROM users WHERE id = ?', task.assignee_user_id);
    if (!assignee) continue;
    await sendTaskReminderEmail(assignee.email, task, { name: task.project_name });
    await run('UPDATE tasks SET reminder_sent = 1 WHERE id = ?', task.id);
    sent += 1;
  }
  return sent;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startReminderSchedule() {
  sendDueReminders().catch((err) => console.error('Reminder sweep failed:', err.message));
  setInterval(() => {
    sendDueReminders().catch((err) => console.error('Reminder sweep failed:', err.message));
  }, CHECK_INTERVAL_MS);
}
