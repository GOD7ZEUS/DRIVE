import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import companiesRouter from './routes/companies.js';
import projectsRouter from './routes/projects.js';
import milestonesRouter from './routes/milestones.js';
import tasksRouter from './routes/tasks.js';
import dashboardRouter from './routes/dashboard.js';
import { requireAuth, requireRole } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Reflects whatever Origin the request came from (needed so a phone hitting the
// PC's LAN IP still works) rather than a hardcoded localhost origin. This app is
// meant to run on a trusted private network / as a desktop app, not be exposed
// to the public internet, so the wider CORS surface is an acceptable trade-off here.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, requireRole('super_admin'), usersRouter);
app.use('/api/companies', requireAuth, requireRole('super_admin'), companiesRouter);

app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/milestones', requireAuth, milestonesRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

export default app;
