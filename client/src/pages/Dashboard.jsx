import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {
  CountdownBadge,
  countTicks,
  showAxisLabel,
  formatMonth,
  getCountdown,
  useElementWidth,
} from '../components/ProjectInsights.jsx';
import { formatDate } from '../dateFormat.js';

const PROJECT_STATUS_ORDER = ['planning', 'active', 'live', 'on_hold', 'completed'];
const PROJECT_STATUS_LABELS = {
  planning: 'Planning',
  active: 'In Development',
  live: 'Live',
  on_hold: 'On Hold',
  completed: 'Completed',
};

const THROUGHPUT_SERIES = [
  { key: 'created', label: 'Created', className: 'series-created' },
  { key: 'completed', label: 'Completed', className: 'series-completed' },
];
const ROLLOUT_SERIES = [{ key: 'count', label: 'Rollouts', className: 'series-rollouts' }];

const HEALTH_SEGMENTS = [
  { key: 'on_track', label: 'On track', className: 'seg-good' },
  { key: 'due_soon', label: 'Due within 14 days', className: 'seg-warning' },
  { key: 'overdue', label: 'Past rollout', className: 'seg-critical' },
  { key: 'no_date', label: 'No rollout date', className: 'seg-neutral' },
];

// Stacked-bar order is deliberate: it keeps On Hold (amber) and Completed
// (green) apart and puts Live (teal) between In Development (blue) and
// Completed (green) — the order that validated for colour-blind readers.
const STACK_ORDER = ['planning', 'on_hold', 'active', 'live', 'completed'];

// "—" rather than "0%" when there is nothing to measure yet (0 of 0).
const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

// Rounded 4px data-end, square at the baseline.
function columnPath(x, y, w, baseline) {
  const h = baseline - y;
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${baseline} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${baseline} Z`;
}

// Columns per month: one or two series, grouped. Each month's group is its
// own hover/focus target and the tooltip lists every series for it.
function ColumnChart({ data, series, ariaLabel, height = 210 }) {
  const [ref, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const margin = { top: 12, right: 8, bottom: 26, left: 32 };
  const innerW = Math.max(width - margin.left - margin.right, 10);
  const innerH = height - margin.top - margin.bottom;
  const ticks = countTicks(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key]))));
  const top = ticks[ticks.length - 1];
  const band = innerW / data.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const baseline = margin.top + innerH;
  const y = (v) => baseline - (v / top) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 52))));
  const groupX = (i) => margin.left + band * i + (band - groupW) / 2;
  const activeRow = active !== null ? data[active] : null;

  return (
    <div className="column-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margin.left} x2={margin.left + innerW} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <g
              key={d.month}
              tabIndex={0}
              className={`column-group${active === i ? ' active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${formatMonth(d.month)}: ${series.map((s) => `${s.label} ${d[s.key]}`).join(', ')}`}
            >
              <rect x={margin.left + band * i} y={margin.top} width={band} height={innerH} className="chart-hit" />
              {series.map((s, si) => (
                <path
                  key={s.key}
                  className={`column ${s.className}`}
                  d={columnPath(groupX(i) + si * (barW + gap), y(d[s.key]), barW, baseline)}
                />
              ))}
              {showAxisLabel(i, data.length, labelEvery) && (
                <text
                  x={margin.left + band * i + band / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className="chart-tick"
                >
                  {formatMonth(d.month)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {activeRow && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(Math.max(margin.left + band * active + band / 2, 70), Math.max(width - 70, 70)),
          }}
          role="status"
        >
          <div className="muted">{formatMonth(activeRow.month)}</div>
          {series.map((s) => (
            <div key={s.key} className="tooltip-row">
              <span className={`line-key ${s.className}`} aria-hidden="true" />
              <strong>{activeRow[s.key]}</strong> <span className="muted">{s.label.toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span key={item.key}>
          <span className={`legend-swatch ${item.className}`} aria-hidden="true" />
          {item.label}
          {item.count !== undefined && <strong>{item.count}</strong>}
        </span>
      ))}
    </div>
  );
}

function StackedBar({ segments, label }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (!total) return <div className="stack-bar stack-bar-empty" aria-label={`${label}: none`} />;
  return (
    <div className="stack-bar" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <div
            key={s.key}
            className={`stack-seg ${s.className}`}
            style={{ flexGrow: s.count }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
    </div>
  );
}

function DataTable({ columns, rows }) {
  return (
    <details className="insights-data">
      <summary>Show data</summary>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>{c.format ? c.format(r[c.key]) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user.role === 'super_admin' || user.role === 'pro_admin';
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
    setError('');
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

  const totalProjects = data ? data.projectsByStatus.reduce((sum, s) => sum + s.count, 0) : 0;
  // Live counts as delivered, same as Completed.
  const completedProjects = data
    ? countFor(data.projectsByStatus, 'completed') + countFor(data.projectsByStatus, 'live')
    : 0;
  const totalTasks = data ? data.tasksByStatus.reduce((sum, s) => sum + s.count, 0) : 0;
  const doneTasks = data ? countFor(data.tasksByStatus, 'done') : 0;
  const overdueItems = data ? data.overdueTasks.length + data.overdueMilestones.length : 0;
  const maxWorkload = data ? Math.max(1, ...data.workload.map((w) => w.open_tasks)) : 1;

  return (
    <div>
      <div className="row-between page-header">
        <div>
          <h1>Dashboard</h1>
        </div>
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
          <div className="grid grid-5">
            {PROJECT_STATUS_ORDER.map((status) => (
              <div key={status} className="panel stat-card">
                <div className="stat-value">{countFor(data.projectsByStatus, status)}</div>
                <div className="stat-label">{PROJECT_STATUS_LABELS[status]} projects</div>
              </div>
            ))}
          </div>

          <div className="kpi-strip">
            <div className="kpi">
              <span className="muted">Total projects</span>
              <strong>{totalProjects}</strong>
            </div>
            <div className="kpi">
              <span className="muted">Projects delivered</span>
              <strong>{pct(completedProjects, totalProjects)}</strong>
              <span className="muted">
                {completedProjects} of {totalProjects}
              </span>
            </div>
            <div className="kpi">
              <span className="muted">Tasks done</span>
              <strong>{pct(doneTasks, totalTasks)}</strong>
              <span className="muted">
                {doneTasks} of {totalTasks}
              </span>
            </div>
            <div className="kpi">
              <span className="muted">Milestones done</span>
              <strong>{pct(data.milestones.done, data.milestones.total)}</strong>
              <span className="muted">
                {data.milestones.done} of {data.milestones.total}
              </span>
            </div>
            <div className={`kpi${overdueItems ? ' kpi-alert' : ''}`}>
              <span className="muted">Overdue items</span>
              <strong>{overdueItems}</strong>
              <span className="muted">tasks &amp; milestones</span>
            </div>
            <div className="kpi">
              <span className="muted">Average TAT</span>
              <strong>{data.avgTatDays != null ? `${data.avgTatDays}d` : '—'}</strong>
              <span className="muted">completed projects</span>
            </div>
          </div>

          <div className="dash-grid">
            <div className="panel dash-card dash-card-wide">
              <h2>Task throughput · last 12 months</h2>
              <Legend items={THROUGHPUT_SERIES} />
              <ColumnChart
                data={data.taskThroughput}
                series={THROUGHPUT_SERIES}
                ariaLabel="Tasks created and completed per month over the last 12 months"
              />
              <DataTable
                columns={[
                  { key: 'month', label: 'Month', format: (m) => formatMonth(m) },
                  { key: 'created', label: 'Created' },
                  { key: 'completed', label: 'Completed' },
                ]}
                rows={data.taskThroughput}
              />
            </div>

            <div className="panel dash-card">
              <h2>Project health</h2>
              <StackedBar
                label="Project health"
                segments={HEALTH_SEGMENTS.map((s) => ({ ...s, count: data.health[s.key] }))}
              />
              <Legend items={HEALTH_SEGMENTS.map((s) => ({ ...s, count: data.health[s.key] }))} />
            </div>
          </div>

          <div className="dash-grid">
            <div className="panel dash-card">
              <h2>Rollouts · next 6 months</h2>
              <ColumnChart
                data={data.rolloutsByMonth}
                series={ROLLOUT_SERIES}
                height={180}
                ariaLabel={`Rollouts per month: ${data.rolloutsByMonth.map((r) => `${formatMonth(r.month)} ${r.count}`).join(', ')}`}
              />
            </div>

            <div className="panel dash-card">
              <h2>Rolling out in the next 30 days</h2>
              {data.upcomingRollouts.length === 0 ? (
                <p className="muted">No rollouts in the next 30 days.</p>
              ) : (
                <div className="dash-list">
                  {data.upcomingRollouts.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="dash-list-row">
                      <div className="dash-list-main">
                        <span className="dash-list-title">{p.name}</span>
                        <span className="muted">
                          {formatDate(p.rollout_date)}
                          {p.responsible_person ? ` · ${p.responsible_person}` : ''}
                        </span>
                      </div>
                      <CountdownBadge countdown={getCountdown({ ...p, current_rollout_date: p.rollout_date })} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dash-grid">
            <div className="panel dash-card dash-card-wide">
              <h2>Team workload</h2>
              {data.workload.length === 0 ? (
                <p className="muted">No assigned work yet.</p>
              ) : (
                <table className="workload-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Projects</th>
                      <th>Open tasks</th>
                      <th>Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workload.map((w) => (
                      <tr key={w.person}>
                        <td className="workload-person">{w.person}</td>
                        <td>{w.projects}</td>
                        <td>
                          <div className="workload-bar-cell">
                            <span className="workload-bar">
                              <span style={{ width: `${(w.open_tasks / maxWorkload) * 100}%` }} />
                            </span>
                            {w.open_tasks}
                          </div>
                        </td>
                        <td className={w.overdue_tasks ? 'workload-overdue' : 'muted'}>{w.overdue_tasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {data.byCompany.length > 1 && (
              <div className="panel dash-card">
                <h2>Projects by company</h2>
                <div className="company-bars">
                  {data.byCompany.map((c) => (
                    <div key={c.company_id} className="company-bar-row">
                      <div className="row-between">
                        <span className="dash-list-title">{c.company}</span>
                        <strong>{c.total}</strong>
                      </div>
                      <StackedBar
                        label={c.company}
                        segments={STACK_ORDER.map((s) => ({
                          key: s,
                          label: PROJECT_STATUS_LABELS[s],
                          count: c[s],
                          className: `status-meter-p-${s}`,
                        }))}
                      />
                    </div>
                  ))}
                </div>
                <Legend
                  items={STACK_ORDER.map((s) => ({
                    key: s,
                    label: PROJECT_STATUS_LABELS[s],
                    className: `status-meter-p-${s}`,
                  }))}
                />
              </div>
            )}
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
                        Rollout {formatDate(p.tat_deadline)}
                        {p.completed_at ? ` · completed ${formatDate(p.completed_at)}` : ' · not yet completed'}
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="dash-grid">
            <div className="section dash-section">
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
                        <div className="muted">Milestone · {m.project_name} · due {formatDate(m.due_date)}</div>
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
                        <div className="muted">Task · {t.project_name} · due {formatDate(t.due_date)}</div>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="section dash-section">
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
                        <div className="muted">Milestone · {m.project_name} · due {formatDate(m.due_date)}</div>
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
                        <div className="muted">Task · {t.project_name} · due {formatDate(t.due_date)}</div>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
