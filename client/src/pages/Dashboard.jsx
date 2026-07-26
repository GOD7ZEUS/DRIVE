import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const PROJECT_STATUS_ORDER = ['planning', 'active', 'on_hold', 'completed'];
const PROJECT_STATUS_LABELS = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const countFor = (statuses, status) => statuses.find((s) => s.status === status)?.count || 0;

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="grid grid-4">
        {PROJECT_STATUS_ORDER.map((status) => (
          <div key={status} className="panel stat-card">
            <div className="stat-value">{countFor(data.projectsByStatus, status)}</div>
            <div className="stat-label">{PROJECT_STATUS_LABELS[status]} projects</div>
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Overdue</h2>
        {data.overdueTasks.length === 0 && data.overdueMilestones.length === 0 ? (
          <p className="muted">Nothing overdue.</p>
        ) : (
          <div className="list">
            {data.overdueMilestones.map((m) => (
              <div key={`m-${m.id}`} className="list-item">
                <div>
                  <div className="title">
                    <Link to={`/projects/${m.project_id}`}>{m.title}</Link>
                  </div>
                  <div className="muted">Milestone · {m.project_name} · due {m.due_date}</div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
            {data.overdueTasks.map((t) => (
              <div key={`t-${t.id}`} className="list-item">
                <div>
                  <div className="title">
                    <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  </div>
                  <div className="muted">Task · {t.project_name} · due {t.due_date}</div>
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Upcoming (next 7 days)</h2>
        {data.upcomingTasks.length === 0 && data.upcomingMilestones.length === 0 ? (
          <p className="muted">Nothing due soon.</p>
        ) : (
          <div className="list">
            {data.upcomingMilestones.map((m) => (
              <div key={`m-${m.id}`} className="list-item">
                <div>
                  <div className="title">
                    <Link to={`/projects/${m.project_id}`}>{m.title}</Link>
                  </div>
                  <div className="muted">Milestone · {m.project_name} · due {m.due_date}</div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
            {data.upcomingTasks.map((t) => (
              <div key={`t-${t.id}`} className="list-item">
                <div>
                  <div className="title">
                    <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  </div>
                  <div className="muted">Task · {t.project_name} · due {t.due_date}</div>
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
