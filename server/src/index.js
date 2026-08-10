import './db.js';
import app from './app.js';
import { startReminderSchedule } from './reminders.js';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Tracker API listening on http://localhost:${PORT}`);
  startReminderSchedule();
});
