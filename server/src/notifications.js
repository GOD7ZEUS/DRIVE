import { Resend } from 'resend';

// Optional, same pattern as auth.js's password-reset emails: without a key,
// these just quietly no-op instead of crashing anything that calls them.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function send(to, subject, html) {
  if (!resend || !to) return;
  try {
    await resend.emails.send({ from: 'Drive <onboarding@resend.dev>', to, subject, html });
  } catch (err) {
    // A failed notification email should never break the request that
    // triggered it (creating/updating a task, or the reminder sweep).
    console.error(`Failed to send email to ${to}:`, err.message);
  }
}

export async function sendTaskAssignedEmail(assigneeEmail, task, project) {
  const dueLine = task.due_date ? `<p>Due date: <strong>${task.due_date}</strong></p>` : '';
  await send(
    assigneeEmail,
    `You've been assigned a task: ${task.title}`,
    `<p>You've been assigned a new task in Drive.</p>
     <p><strong>${task.title}</strong>${task.description ? `<br>${task.description}` : ''}</p>
     <p>Project: ${project.name}</p>
     ${dueLine}`
  );
}

export async function sendTaskReminderEmail(assigneeEmail, task, project) {
  await send(
    assigneeEmail,
    `Reminder: "${task.title}" is due ${task.due_date}`,
    `<p>This is a reminder that a task assigned to you is due soon.</p>
     <p><strong>${task.title}</strong>${task.description ? `<br>${task.description}` : ''}</p>
     <p>Project: ${project.name}</p>
     <p>Due date: <strong>${task.due_date}</strong></p>`
  );
}
