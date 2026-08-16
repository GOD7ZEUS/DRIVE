import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const PROJECT_STATUS_ORDER = ['planning', 'active', 'on_hold', 'completed'];
const PROJECT_STATUS_LABELS = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
};

export default function Dashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user.role === 'super_admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const companyFilter = searchParams.get('companyId') || 'all';
  const departmentFilter = searchParams.get('departmentId') || 'all';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [companies, setCompanies] = useState(null);
  const [departments, setDepartments] = useState(null);

  useEffect(() => {
    if (isSuperAdmin) api.getCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin || companyFilter === 'all') {
      setDepartments(null);
      return;
    }
    api.getCompanyDepartments(companyFilter).then(setDepartments).catch(() => setDepartments([]));
  }, [isSuperAdmin, companyFilter]);

  useEffect(() => {
    const companyId = companyFilter !== 'all' ? companyFilter : undefined;
    const departmentId = departmentFilter !== 'all' ? departmentFilter : undefined;
    setData(null);
    api.getDashboard(companyId, departmentId).then(setData).catch((e) => setError(e.message));
  }, [companyFilter, departmentFilter]);

  function handleCompanyFilterChange(value) {
    setSearchParams(value === 'all' ? {} : { companyId: value });
  }

  function handleDepartmentFilterChange(value) {
    setSearchParams(value === 'all' ? { companyId: companyFilter } : { companyId: companyFilter, departmentId: value });
  }

  if (error) return <p className="error">{error}</p>;

  const countFor = (statuses, status) => statuses.find((s) => s.status === status)?.count || 0;

  return (
    <div>
      <div className="row-between">
        <h1>Dashboard</h1>
        {isSuperAdmin && companies && companies.length > 0 && (
          <div className="row dashboard-filters">
            <label className="filter-group">
              <span className="muted">Company</span>
              <select value={companyFilter} onChange={(e) => handleCompanyFilterChange(e.target.value)}>
                <option value="all">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {companyFilter !== 'all' && departments && departments.length > 0 && (
              <label className="filter-group">
                <span className="muted">Department</span>
                <select value={departmentFilter} onChange={(e) => handleDepartmentFilterChange(e.target.value)}>
                  <option value="all">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-4">
            {PROJECT_STATUS_ORDER.map((status) => (
              <div key={status} className="panel stat-card">
                <div className="stat-value">{countFor(data.projectsByStatus, status)}</div>
                <div className="stat-label">{PROJECT_STATUS_LABELS[status]} projects</div>
              </div>
            ))}
          </div>

          <div className="section">
            <h2>Turn-Around Time (TAT)</h2>
            <div className="grid grid-3">
              <div className="panel stat-card">
                <div className="stat-value">{data.avgTatDays != null ? `${data.avgTatDays}d` : '—'}</div>
                <div className="stat-label">Average TAT</div>
              </div>
              <div className="panel stat-card">
                <div className="stat-value">{data.projectsInTat.length}</div>
                <div className="stat-label">Projects in TAT</div>
              </div>
              <div className="panel stat-card">
                <div className="stat-value">{data.projectsExceedingTat.length}</div>
                <div className="stat-label">Projects exceeding TAT</div>
              </div>
            </div>

            {data.projectsExceedingTat.length > 0 && (
              <div className="list" style={{ marginTop: 16 }}>
                {data.projectsExceedingTat.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="list-item">
                    <div>
                      <div className="title">{p.name}</div>
                      <div className="muted">
                        Rollout {p.tat_deadline}
                        {p.completed_at ? ` · completed ${p.completed_at.slice(0, 10)}` : ' · not yet completed'}
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
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
        </>
      )}
    </div>
  );
}
