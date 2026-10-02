import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABELS } from './StatusBadge.jsx';
import { formatDate } from '../dateFormat.js';

// Project insights: the compact block on each project card and the full
// panel on the project page. Access is master's by default (master can grant
// it per account — the server enforces that); on top of access, each person
// switches "Show insights" on for themselves. Display-only.

const SHOW_INSIGHTS_KEY = 'drive.showInsights';

// Off until the person turns it on; remembered per browser. Shared by the
// Projects list and the project page so the choice carries between them.
export function useShowInsightsPreference() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SHOW_INSIGHTS_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const update = (value) => {
    setOn(value);
    try {
      localStorage.setItem(SHOW_INSIGHTS_KEY, value ? 'on' : 'off');
    } catch {
      // Storage unavailable — the choice lasts for this visit only.
    }
  };
  return [on, update];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERED = ['live', 'completed'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localDay(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Server timestamps are UTC ('YYYY-MM-DD HH:MM:SS'); a commencement just after
// midnight UTC is still the previous day in India, so convert before
// taking the date.
function localDayFromUtc(timestamp) {
  // SQLite's 'YYYY-MM-DD HH:MM:SS' carries no zone marker; a JS ISO string
  // (projects.completed_at) already ends in Z.
  const t = new Date(timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatMonth(monthKey, withYear = true) {
  const [y, m] = monthKey.split('-');
  return withYear ? `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}` : MONTH_NAMES[Number(m) - 1];
}

export function commencementDate(project) {
  return project.commenced_at ? toIsoDate(localDayFromUtc(project.commenced_at)) : null;
}

// Countdown from today to the current rollout date, plus how far through the
// commencement → rollout span the project is.
export function getCountdown(project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = project.commenced_at ? localDayFromUtc(project.commenced_at) : null;

  if (!project.current_rollout_date) {
    return { state: 'no-date', label: 'No rollout date', percent: null, start };
  }
  const rollout = localDay(project.current_rollout_date);
  // A finished project's clock stops on the day it was completed.
  const completedDay =
    DELIVERED.includes(project.status) && project.completed_at ? localDayFromUtc(project.completed_at) : null;
  const endDay = completedDay || today;
  const daysLeft = daysBetween(endDay, rollout);
  const totalDays = start ? Math.max(daysBetween(start, rollout), 0) : null;
  const elapsedDays = start ? Math.max(daysBetween(start, endDay), 0) : null;
  let percent = null;
  if (totalDays !== null) {
    percent = totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : daysLeft <= 0 ? 100 : 0;
  }

  let state;
  let label;
  if (DELIVERED.includes(project.status)) {
    // Live counts as delivered, same as Completed — judged by its go-live date.
    state = 'completed';
    const prefix = project.status === 'live' ? 'Live ·' : 'Completed';
    label = completedDay && daysLeft < 0 ? `${prefix} ${plural(-daysLeft, 'day')} late` : `${prefix} on time`;
  } else if (daysLeft < 0) {
    state = 'overdue';
    label = `${plural(-daysLeft, 'day')} overdue`;
  } else if (daysLeft === 0) {
    state = 'today';
    label = 'Rollout today';
  } else {
    state = daysLeft <= 14 ? 'soon' : 'on-track';
    label = `${plural(daysLeft, 'day')} left`;
  }
  return { state, label, daysLeft, totalDays, elapsedDays, percent, start, rollout };
}

// "Day 40 of 120" — or, once a project runs past its plan, "Day 154 · planned
// 132" rather than the nonsensical "Day 154 of 132".
function dayLabel(countdown) {
  return countdown.elapsedDays > countdown.totalDays
    ? `Day ${countdown.elapsedDays} · planned ${countdown.totalDays}`
    : `Day ${countdown.elapsedDays} of ${countdown.totalDays}`;
}

export function CountdownBadge({ countdown }) {
  return (
    <span className={`countdown countdown-${countdown.state}`}>
      <span className="countdown-dot" aria-hidden="true" />
      {countdown.label}
    </span>
  );
}

function SpanMeter({ countdown }) {
  if (countdown.percent === null) return null;
  return (
    <div
      className={`span-meter span-meter-${countdown.state}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={countdown.percent}
      aria-label="Time elapsed from commencement to rollout"
    >
      <div className="span-meter-fill" style={{ width: `${countdown.percent}%` }} />
    </div>
  );
}

// Card-sized trend: running total of completed tasks per month. One series,
// so no legend — the caption above it names it. Hovering a point shows its
// month and values (native tooltip; the card itself is a link).
function Sparkline({ months, width = 176, height = 38 }) {
  const pad = 5;
  const max = Math.max(1, ...months.map((m) => m.cumulative));
  const x = (i) => (months.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (months.length - 1));
  const y = (v) => height - pad - (v / max) * (height - pad * 2);
  const points = months.map((m, i) => [x(i), y(m.cumulative)]);
  const line = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height - pad} L${points[0][0].toFixed(1)},${height - pad} Z`;
  const [endX, endY] = points[points.length - 1];

  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="chart-grid" />
      {months.length > 1 && <path d={area} className="chart-area" />}
      {months.length > 1 && <path d={line} className="chart-line" />}
      {months.map((m, i) => (
        <circle key={m.month} cx={points[i][0]} cy={points[i][1]} r={7} className="chart-hit">
          <title>{`${formatMonth(m.month)}: ${m.completed} completed · ${m.cumulative} total`}</title>
        </circle>
      ))}
      <circle cx={endX} cy={endY} r={4} className="chart-dot" />
    </svg>
  );
}

export function CardInsights({ project, insights }) {
  const countdown = getCountdown(project);
  const months = insights?.months ?? [];
  const last = insights?.lastTask;
  return (
    <div className="card-insights" aria-label="Project insights">
      <CountdownBadge countdown={countdown} />
      {countdown.percent !== null && (
        <div className="card-insights-span">
          <SpanMeter countdown={countdown} />
          <span className="muted">
            {dayLabel(countdown)}
          </span>
        </div>
      )}
      <div className="card-insights-trend">
        <span className="muted">
          Tasks done <strong>{insights ? `${insights.doneTasks}/${insights.totalTasks}` : '—'}</strong>
        </span>
        {!insights || insights.totalTasks === 0 ? (
          <span className="muted card-insights-empty">No tasks yet</span>
        ) : insights.doneTasks === 0 ? (
          <span className="muted card-insights-empty">None completed yet</span>
        ) : (
          <Sparkline months={months} />
        )}
      </div>
      {last && (
        <div className="card-insights-last" title={`Last updated task: ${last.title}`}>
          <span className="muted">Last:</span> <span className="card-insights-last-title">{last.title}</span>
          <span className={`badge badge-${last.status}`}>{STATUS_LABELS[last.status] || last.status}</span>
        </div>
      )}
    </div>
  );
}

export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Month axis labels: every `every`-th month plus always the last one — but a
// regular label that would land within one stride of the last is dropped,
// so the final two never print on top of each other ("Sep 26Oct 26").
export function showAxisLabel(i, count, every) {
  const last = count - 1;
  if (i === last) return true;
  return i % every === 0 && last - i >= every;
}

// Whole-number ticks only — these are task counts, so "1.5" is never a
// valid label. Picks the smallest clean step that needs at most 4 intervals.
export function countTicks(value) {
  const max = Math.max(value, 1);
  for (let magnitude = 1; ; magnitude *= 10) {
    for (const base of [1, 2, 5]) {
      const step = base * magnitude;
      const intervals = Math.ceil(max / step);
      if (intervals <= 4) return Array.from({ length: intervals + 1 }, (_, i) => i * step);
    }
  }
}

// Full-size trend on the project page: running total of completed tasks by
// month, with a crosshair that snaps to the nearest month and a tooltip
// (also reachable by keyboard — arrow keys step through the months).
function TrendChart({ months }) {
  const [containerRef, width] = useElementWidth();
  const [active, setActive] = useState(null);
  const height = 220;
  const margin = { top: 14, right: 18, bottom: 28, left: 34 };
  const innerW = Math.max(width - margin.left - margin.right, 10);
  const innerH = height - margin.top - margin.bottom;
  const ticks = countTicks(Math.max(...months.map((m) => m.cumulative), 0));
  const top = ticks[ticks.length - 1];

  const x = (i) => margin.left + (months.length === 1 ? innerW / 2 : (i * innerW) / (months.length - 1));
  const y = (v) => margin.top + innerH - (v / top) * innerH;
  const points = months.map((m, i) => [x(i), y(m.cumulative)]);
  const line = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const baseline = margin.top + innerH;
  const area =
    points.length > 1
      ? `${line} L${points[points.length - 1][0].toFixed(1)},${baseline} L${points[0][0].toFixed(1)},${baseline} Z`
      : null;
  const labelEvery = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(innerW / 64))));

  function onPointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (months.length === 1) return setActive(0);
    const i = Math.round(((px - margin.left) / innerW) * (months.length - 1));
    setActive(Math.min(months.length - 1, Math.max(0, i)));
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((cur) => Math.min(months.length - 1, Math.max(0, (cur ?? months.length - 1) + step)));
    }
  }

  const activeMonth = active !== null ? months[active] : null;
  const tooltipLeft = active !== null ? Math.min(Math.max(points[active][0], 70), Math.max(width - 70, 70)) : 0;

  return (
    <div className="trend-chart" ref={containerRef}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Tasks completed, running total by month: ${months.map((m) => `${formatMonth(m.month)} ${m.cumulative}`).join(', ')}`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(months.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margin.left} x2={margin.left + innerW} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
                {t}
              </text>
            </g>
          ))}
          {months.map((m, i) =>
            showAxisLabel(i, months.length, labelEvery) ? (
              <text
                key={m.month}
                x={x(i)}
                y={height - 8}
                // Edge labels anchor inward so the first/last month never
                // overhang the chart and get clipped.
                textAnchor={months.length > 1 && i === 0 ? 'start' : months.length > 1 && i === months.length - 1 ? 'end' : 'middle'}
                className="chart-tick"
              >
                {formatMonth(m.month)}
              </text>
            ) : null
          )}
          {area && <path d={area} className="chart-area" />}
          {points.length > 1 && <path d={line} className="chart-line" />}
          {activeMonth && (
            <line
              x1={points[active][0]}
              x2={points[active][0]}
              y1={margin.top}
              y2={baseline}
              className="chart-crosshair"
            />
          )}
          {points.map(([px, py], i) =>
            i === points.length - 1 || i === active ? (
              <circle key={months[i].month} cx={px} cy={py} r={4} className="chart-dot" />
            ) : null
          )}
          <text
            x={points[points.length - 1][0]}
            y={points[points.length - 1][1] - 10}
            textAnchor="end"
            className="chart-end-label"
          >
            {months[months.length - 1].cumulative}
          </text>
        </svg>
      )}
      {activeMonth && (
        <div className="chart-tooltip" style={{ left: tooltipLeft }} role="status">
          <strong>{activeMonth.cumulative}</strong> completed in total
          <div className="muted">
            {formatMonth(activeMonth.month)} · {activeMonth.completed} this month
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_ORDER = ['todo', 'in_progress', 'done'];

function StatusMeter({ statusCounts, total }) {
  if (!total) return <p className="muted">No tasks yet.</p>;
  return (
    <>
      <div className="status-meter" role="img" aria-label={STATUS_ORDER.map((s) => `${STATUS_LABELS[s]} ${statusCounts[s] || 0}`).join(', ')}>
        {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
          <div
            key={s}
            className={`status-meter-seg status-meter-${s}`}
            style={{ flexGrow: statusCounts[s] }}
            title={`${STATUS_LABELS[s]}: ${statusCounts[s]}`}
          />
        ))}
      </div>
      <div className="status-legend">
        {STATUS_ORDER.map((s) => (
          <span key={s}>
            <span className={`status-swatch status-meter-${s}`} aria-hidden="true" />
            {STATUS_LABELS[s]} <strong>{statusCounts[s] || 0}</strong>
          </span>
        ))}
      </div>
    </>
  );
}

function TaskLine({ task, showDue }) {
  return (
    <Link to={`/tasks/${task.id}`} className="insights-task">
      <span className="insights-task-title">{task.title}</span>
      <span className="muted">
        {showDue ? `due ${formatDate(task.due_date)}` : task.assignee || 'Unassigned'}
      </span>
      <span className={`badge badge-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span>
    </Link>
  );
}

export function ProjectInsightsPanel({ project, insights, onHide }) {
  const countdown = useMemo(() => getCountdown(project), [project]);
  const commenced = commencementDate(project);
  if (!insights) return <p className="muted">Loading insights…</p>;
  const donePct = insights.totalTasks ? Math.round((insights.doneTasks / insights.totalTasks) * 100) : 0;

  return (
    <div className="panel insights-panel">
      <div className="row-between">
        <h2>Project Insights</h2>
        {onHide && (
          <button type="button" className="link-button" onClick={onHide}>
            Hide insights
          </button>
        )}
      </div>

      <div className="insights-tiles">
        <div className="insights-tile">
          <span className="muted">Project Commencement Date</span>
          <strong>{commenced ? formatDate(commenced) : '—'}</strong>
        </div>
        <div className="insights-tile">
          <span className="muted">Rollout Date</span>
          <strong>{project.current_rollout_date ? formatDate(project.current_rollout_date) : '—'}</strong>
          {insights.rolloutRevisions > 1 && (
            <span className="muted">revised {plural(insights.rolloutRevisions - 1, 'time')}</span>
          )}
        </div>
        <div className="insights-tile">
          <span className="muted">Countdown</span>
          <CountdownBadge countdown={countdown} />
        </div>
        <div className="insights-tile">
          <span className="muted">Time elapsed</span>
          {countdown.percent !== null ? (
            <>
              <strong>{countdown.percent}%</strong>
              <SpanMeter countdown={countdown} />
              <span className="muted">
                {dayLabel(countdown)}
              </span>
            </>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div className="insights-tile">
          <span className="muted">Tasks done</span>
          <strong>
            {insights.doneTasks}/{insights.totalTasks}
          </strong>
          <span className="muted">{donePct}% complete</span>
        </div>
        <div className="insights-tile">
          <span className="muted">Milestones done</span>
          <strong>
            {insights.milestones.done}/{insights.milestones.total}
          </strong>
        </div>
      </div>

      <div className="insights-grid">
        <div className="insights-card insights-card-wide">
          <h3>Tasks completed over time</h3>
          {insights.totalTasks > 0 ? (
            <>
              <TrendChart months={insights.months} />
              <details className="insights-data">
                <summary>Show data</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Completed</th>
                      <th>Running total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.months.map((m) => (
                      <tr key={m.month}>
                        <td>{formatMonth(m.month)}</td>
                        <td>{m.completed}</td>
                        <td>{m.cumulative}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="muted">No tasks yet — the trend appears once tasks are added.</p>
          )}
        </div>
        <div className="insights-card">
          <h3>Task status</h3>
          <StatusMeter statusCounts={insights.statusCounts} total={insights.totalTasks} />
          {insights.lastTask && (
            <>
              <h3 className="insights-subhead">Last updated task</h3>
              <TaskLine task={insights.lastTask} />
            </>
          )}
        </div>
      </div>

      <div className="insights-grid">
        <div className="insights-card">
          <h3>Overdue tasks {insights.overdueTasks.length > 0 && <span className="badge badge-overdue">{insights.overdueTasks.length}</span>}</h3>
          {insights.overdueTasks.length === 0 ? (
            <p className="muted">Nothing overdue.</p>
          ) : (
            insights.overdueTasks.map((t) => <TaskLine key={t.id} task={t} showDue />)
          )}
        </div>
        <div className="insights-card">
          <h3>Recent task activity</h3>
          {insights.recentTasks.length === 0 ? (
            <p className="muted">No tasks yet.</p>
          ) : (
            insights.recentTasks.map((t) => <TaskLine key={t.id} task={t} />)
          )}
        </div>
      </div>
    </div>
  );
}
