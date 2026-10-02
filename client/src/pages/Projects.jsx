import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge, { STATUS_LABELS } from '../components/StatusBadge.jsx';
import { CardInsights, commencementDate, useShowInsightsPreference } from '../components/ProjectInsights.jsx';
import CompanyDepartmentFields from '../components/CompanyDepartmentFields.jsx';
import SubDepartmentField from '../components/SubDepartmentField.jsx';
import { formatUserName } from '../userDisplay.js';
import { formatDate } from '../dateFormat.js';

const STATUSES = ['planning', 'active', 'live', 'on_hold', 'completed'];
const FILTER_STORAGE_KEY = 'projects.filters';
const SORT_STORAGE_KEY = 'projects.rolloutSort';
const NO_FILTERS = { companyId: 'all', departmentId: 'all', userId: 'all', status: 'all', from: '', to: '' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function filtersToParams(filters) {
  const params = {};
  if (filters.companyId !== 'all') params.companyId = filters.companyId;
  if (filters.departmentId !== 'all') params.departmentId = filters.departmentId;
  if (filters.userId !== 'all') params.userId = filters.userId;
  if (filters.status !== 'all') params.status = filters.status;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  return params;
}

// Filters live in the URL (so links from the Companies page still work) and
// are mirrored to sessionStorage, so opening a project and coming back —
// via the breadcrumb or the nav bar, which both drop the query string —
// restores them instead of resetting everything.
function readInitialFilters(searchParams) {
  let source = searchParams;
  const urlHasFilters = Object.keys(NO_FILTERS).some((k) => searchParams.get(k));
  if (!urlHasFilters) {
    try {
      const saved = sessionStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) source = new URLSearchParams(saved);
    } catch {
      // Storage unavailable (e.g. private mode) — just start unfiltered.
    }
  }
  const status = source.get('status');
  const from = source.get('from') || '';
  const to = source.get('to') || '';
  return {
    companyId: source.get('companyId') || 'all',
    departmentId: source.get('departmentId') || 'all',
    userId: source.get('userId') || 'all',
    status: STATUSES.includes(status) ? status : 'all',
    from: ISO_DATE.test(from) ? from : '',
    to: ISO_DATE.test(to) ? to : '',
  };
}

export default function Projects() {
  const { user } = useAuth();
  const isSuperAdmin = user.role === 'super_admin';
  const isProAdmin = user.role === 'pro_admin';
  // Gates the New Project form's own company/department fields — View never
  // sees that form at all (canEdit below), so this stays narrow on purpose.
  const canPickCompany = isSuperAdmin || isProAdmin;
  const canEdit = user.role !== 'view';
  // Company/Department/Sub Department info and the Company/Department/User
  // filters are all read-only — nothing here lets a view-only account change
  // anything, so View gets the same unscoped overview it already has on the
  // dashboard, not just a bare project list.
  const canSeeCompanyInfo = canPickCompany || user.role === 'view';
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planning');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [assignedByUserId, setAssignedByUserId] = useState('');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [departmentId, setDepartmentId] = useState(null);
  const [subDepartment, setSubDepartment] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [ownDepartments, setOwnDepartments] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState(() => readInitialFilters(searchParams));
  const [rolloutSort, setRolloutSort] = useState(() => {
    try {
      return localStorage.getItem(SORT_STORAGE_KEY) === 'latest' ? 'latest' : 'earliest';
    } catch {
      return 'earliest';
    }
  });

  // Access comes from the server (master, or granted by master); whether the
  // insights actually show is each person's own "Show insights" choice.
  const canViewInsights = !!user.can_view_insights;
  const [showInsightsPref, setShowInsightsPref] = useShowInsightsPreference();
  const insightsOn = canViewInsights && showInsightsPref;
  const [insights, setInsights] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const filtersRef = useRef(null);

  function load() {
    api.getProjects().then(setProjects).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  // Fetched only while insights are switched on — and again after the
  // project list reloads (e.g. a new project), so cards never go stale.
  useEffect(() => {
    if (!insightsOn) return;
    api.getProjectsInsights().then(setInsights).catch(() => setInsights({}));
  }, [insightsOn, projects]);

  useEffect(() => {
    if (!showFilters) return undefined;
    const onPointerDown = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setShowFilters(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowFilters(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showFilters]);

  // If the filters were restored from sessionStorage rather than the URL,
  // put them back in the URL too, so what's shown and the address match.
  useEffect(() => {
    setSearchParams(filtersToParams(filters), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetched unconditionally (not just while the New Project form is open) —
  // it also feeds the Responsible Person filter.
  useEffect(() => {
    api.getAllAssignableUsers().then(setAssignableUsers).catch(() => setAssignableUsers([]));
  }, []);

  useEffect(() => {
    if (!showForm || !isProAdmin) return;
    api.getCompanyDepartments(user.company_id).then(setOwnDepartments).catch(() => setOwnDepartments([]));
  }, [showForm, isProAdmin, user.company_id]);

  function updateFilters(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const params = filtersToParams(next);
    setSearchParams(params, { replace: true });
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, new URLSearchParams(params).toString());
    } catch {
      // Storage unavailable — filters still work, they just won't persist.
    }
  }

  function toggleRolloutSort() {
    const next = rolloutSort === 'earliest' ? 'latest' : 'earliest';
    setRolloutSort(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the toggle still works for this visit.
    }
  }

  const companies = useMemo(() => {
    const byId = new Map();
    for (const p of projects || []) {
      if (p.company_id) byId.set(p.company_id, p.company);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects]);

  // Narrowed to the selected company. With "All companies", department names
  // can repeat across companies (e.g. Supply Chain Management at both), so
  // the company is shown alongside to tell them apart.
  const departments = useMemo(() => {
    const byId = new Map();
    for (const p of projects || []) {
      if (!p.department_id) continue;
      if (filters.companyId !== 'all' && String(p.company_id) !== filters.companyId) continue;
      byId.set(p.department_id, filters.companyId === 'all' ? `${p.department} — ${p.company}` : p.department);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects, filters.companyId]);

  // Company/department/user scoping only — kept separate from the status
  // filter so the status tabs' own counts reflect "how many would show with
  // the other filters as they are", not collapse to zero against themselves.
  const scopedProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => {
      if (canSeeCompanyInfo) {
        if (filters.companyId !== 'all' && String(p.company_id) !== filters.companyId) return false;
        if (filters.departmentId !== 'all' && String(p.department_id) !== filters.departmentId) return false;
        if (filters.userId !== 'all' && String(p.responsible_user_id) !== filters.userId) return false;
      }
      // Rollout window, both ends inclusive. Once either end is set, projects
      // with no rollout date can't fall inside it, so they're left out.
      if (filters.from || filters.to) {
        const date = p.current_rollout_date;
        if (!date) return false;
        if (filters.from && date < filters.from) return false;
        if (filters.to && date > filters.to) return false;
      }
      return true;
    });
  }, [projects, filters, canSeeCompanyInfo]);

  const statusCounts = useMemo(() => {
    const counts = { all: scopedProjects.length };
    for (const s of STATUSES) counts[s] = scopedProjects.filter((p) => p.status === s).length;
    return counts;
  }, [scopedProjects]);

  const visibleProjects = useMemo(() => {
    const filtered =
      filters.status === 'all' ? scopedProjects : scopedProjects.filter((p) => p.status === filters.status);
    // Projects with no rollout date set yet sink to the bottom in either
    // direction, rather than jumping to the top when the order flips.
    const direction = rolloutSort === 'latest' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (!a.current_rollout_date && !b.current_rollout_date) return 0;
      if (!a.current_rollout_date) return 1;
      if (!b.current_rollout_date) return -1;
      return direction * a.current_rollout_date.localeCompare(b.current_rollout_date);
    });
  }, [scopedProjects, filters.status, rolloutSort]);

  // A restored or hand-typed filter can point at something that's not in the
  // current list (a deleted department, a link from someone with a wider
  // view) — the dropdown would then read "All …" while still silently
  // filtering. Drop any such value once the options are known.
  useEffect(() => {
    if (!projects) return;
    const patch = {};
    const has = (list, id) => list.some(([optionId]) => String(optionId) === id);
    if (!canSeeCompanyInfo) {
      if (filters.companyId !== 'all') patch.companyId = 'all';
      if (filters.departmentId !== 'all') patch.departmentId = 'all';
      if (filters.userId !== 'all') patch.userId = 'all';
    } else {
      if (filters.companyId !== 'all' && !has(companies, filters.companyId)) patch.companyId = 'all';
      if (filters.departmentId !== 'all' && !has(departments, filters.departmentId)) patch.departmentId = 'all';
      if (
        filters.userId !== 'all' &&
        assignableUsers.length > 0 &&
        !assignableUsers.some((u) => String(u.id) === filters.userId)
      ) {
        patch.userId = 'all';
      }
    }
    if (Object.keys(patch).length > 0) updateFilters(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, companies, departments, assignableUsers, canSeeCompanyInfo]);

  // The status tabs are always on screen, so they don't count toward the
  // Filters badge — only what's tucked inside the popover does.
  const popoverFilterKeys = ['companyId', 'departmentId', 'userId', 'from', 'to'];
  const activeFilterCount =
    popoverFilterKeys.filter((k) => k !== 'to' && filters[k] !== NO_FILTERS[k]).length +
    (filters.to && !filters.from ? 1 : 0);
  const hasActiveFilters = Object.keys(NO_FILTERS).some((k) => filters[k] !== NO_FILTERS[k]);

  // Chips under the status tabs, so what's filtered stays visible with the
  // popover closed. Each one clears just itself.
  const labelFor = (list, id) => list.find(([optionId]) => String(optionId) === id)?.[1] ?? id;
  const activeChips = [];
  if (filters.companyId !== 'all') {
    activeChips.push({ key: 'company', label: 'Company', value: labelFor(companies, filters.companyId), clear: { companyId: 'all', departmentId: 'all' } });
  }
  if (filters.departmentId !== 'all') {
    activeChips.push({ key: 'department', label: 'Department', value: labelFor(departments, filters.departmentId), clear: { departmentId: 'all' } });
  }
  if (filters.userId !== 'all') {
    const u = assignableUsers.find((au) => String(au.id) === filters.userId);
    activeChips.push({ key: 'user', label: 'Responsible', value: u ? formatUserName(u) : '…', clear: { userId: 'all' } });
  }
  if (filters.from || filters.to) {
    const value = filters.from && filters.to
      ? `${formatDate(filters.from)} – ${formatDate(filters.to)}`
      : filters.from
        ? `from ${formatDate(filters.from)}`
        : `until ${formatDate(filters.to)}`;
    activeChips.push({ key: 'dates', label: 'Rollout', value, clear: { from: '', to: '' } });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        name,
        description,
        status,
        responsible_user_id: responsibleUserId || null,
      };
      if (isSuperAdmin && assignedByUserId) {
        payload.assigned_by_user_id = assignedByUserId;
      }
      if (canPickCompany) {
        payload.company = company;
        payload.department = department;
      }
      if (subDepartment.trim()) {
        payload.sub_department = subDepartment;
      }
      await api.createProject(payload);
      setName('');
      setDescription('');
      setStatus('planning');
      setResponsibleUserId('');
      setAssignedByUserId('');
      setCompany('');
      setDepartment('');
      setDepartmentId(null);
      setSubDepartment('');
      setShowForm(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="row-between page-header">
        <h1>Projects</h1>
        <div className="row page-actions">
          {projects && projects.length > 0 && (
            <>
              <button type="button" onClick={toggleRolloutSort} title="Sort by rollout date — click to flip">
                {rolloutSort === 'earliest' ? '↑ Earliest rollout' : '↓ Latest rollout'}
              </button>
              <div className="filters-anchor" ref={filtersRef}>
                <button
                  type="button"
                  className={`filters-button${activeFilterCount ? ' has-active' : ''}`}
                  aria-expanded={showFilters}
                  aria-controls="project-filters"
                  onClick={() => setShowFilters((s) => !s)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M1.5 3h13l-5 6v4.5l-3 1.5V9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  Filters
                  {activeFilterCount > 0 && <span className="filters-count">{activeFilterCount}</span>}
                </button>
                {showFilters && (
                  <div className="filters-popover" id="project-filters" role="dialog" aria-label="Project filters">
                    <div className="row-between">
                      <strong>Filters</strong>
                      <button type="button" className="icon-button" aria-label="Close filters" onClick={() => setShowFilters(false)}>
                        ×
                      </button>
                    </div>
                    {canSeeCompanyInfo && (
                      <>
                        <label className="filter-field">
                          <span className="muted">Company</span>
                          <select
                            value={filters.companyId}
                            onChange={(e) => updateFilters({ companyId: e.target.value, departmentId: 'all' })}
                          >
                            <option value="all">All companies</option>
                            {companies.map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="filter-field">
                          <span className="muted">Department</span>
                          <select
                            value={filters.departmentId}
                            onChange={(e) => updateFilters({ departmentId: e.target.value })}
                          >
                            <option value="all">All departments</option>
                            {departments.map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="filter-field">
                          <span className="muted">Responsible Person</span>
                          <select value={filters.userId} onChange={(e) => updateFilters({ userId: e.target.value })}>
                            <option value="all">All users</option>
                            {assignableUsers.map((u) => (
                              <option key={u.id} value={u.id}>
                                {formatUserName(u)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    <fieldset className="filter-field filter-dates">
                      <legend className="muted">Rollout date between</legend>
                      <label>
                        <span className="muted">Start date</span>
                        <input
                          type="date"
                          value={filters.from}
                          max={filters.to || undefined}
                          onChange={(e) => updateFilters({ from: e.target.value })}
                        />
                      </label>
                      <label>
                        <span className="muted">End date</span>
                        <input
                          type="date"
                          value={filters.to}
                          min={filters.from || undefined}
                          onChange={(e) => updateFilters({ to: e.target.value })}
                        />
                      </label>
                      {filters.from && filters.to && filters.from > filters.to && (
                        <p className="error">Start date is after end date.</p>
                      )}
                    </fieldset>
                    {canViewInsights && (
                      <label className="switch filter-insights-switch">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={showInsightsPref}
                          onChange={(e) => setShowInsightsPref(e.target.checked)}
                        />
                        <span className="switch-track" aria-hidden="true" />
                        <span>
                          Show insights
                        </span>
                      </label>
                    )}
                    <div className="row-between filters-popover-footer">
                      <button
                        type="button"
                        className="link-button"
                        disabled={!hasActiveFilters}
                        onClick={() => updateFilters(NO_FILTERS)}
                      >
                        Clear all
                      </button>
                      <button type="button" className="primary" onClick={() => setShowFilters(false)}>
                        Show {visibleProjects.length} {visibleProjects.length === 1 ? 'project' : 'projects'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {canEdit && (
            <button className="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? 'Cancel' : 'New Project'}
            </button>
          )}
        </div>
      </div>

      {canEdit && showForm && (
        <form className="panel form-grid" onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
          <label>
            Name
            <br />
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            Description
            <br />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label>
            Status
            <br />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsible Person
            <br />
            <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserName(u)}
                </option>
              ))}
            </select>
          </label>
          {isSuperAdmin && (
            <label>
              Assigned By <span className="muted">(optional)</span>
              <br />
              <select value={assignedByUserId} onChange={(e) => setAssignedByUserId(e.target.value)}>
                <option value="">Not set</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {formatUserName(u)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isSuperAdmin ? (
            <>
              <CompanyDepartmentFields
                company={company}
                department={department}
                onCompanyChange={setCompany}
                onDepartmentChange={setDepartment}
                onIdsChange={(_companyId, deptId) => setDepartmentId(deptId)}
              />
              <SubDepartmentField departmentId={departmentId} value={subDepartment} onChange={setSubDepartment} />
            </>
          ) : isProAdmin ? (
            <>
              <label>
                Department
                <br />
                <select
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    const selected = ownDepartments?.find((d) => d.name === e.target.value);
                    setDepartmentId(selected ? selected.id : null);
                  }}
                  required
                >
                  <option value="" disabled>
                    {ownDepartments ? 'Select a department…' : 'Loading…'}
                  </option>
                  {ownDepartments?.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <SubDepartmentField departmentId={departmentId} value={subDepartment} onChange={setSubDepartment} />
            </>
          ) : (
            <>
              <p className="muted">
                Will be created under <strong>{user.company}</strong> / <strong>{user.department}</strong>
              </p>
              <SubDepartmentField
                departmentId={user.department_id}
                value={subDepartment}
                onChange={setSubDepartment}
              />
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div>
            <button type="submit" className="primary" disabled={submitting}>
              Create
            </button>
          </div>
        </form>
      )}

      {projects && projects.length > 0 && (
        <>
          <div className="status-tabs">
            <button
              type="button"
              className={filters.status === 'all' ? 'active' : ''}
              onClick={() => updateFilters({ status: 'all' })}
            >
              All <span className="muted">({statusCounts.all})</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={filters.status === s ? 'active' : ''}
                onClick={() => updateFilters({ status: s })}
              >
                {STATUS_LABELS[s]} <span className="muted">({statusCounts[s]})</span>
              </button>
            ))}
          </div>

          {activeChips.length > 0 && (
            <div className="filter-chips" aria-label="Active filters">
              {activeChips.map((chip) => (
                <span key={chip.key} className="filter-chip">
                  <span className="muted">{chip.label}:</span> {chip.value}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label} filter`}
                    onClick={() => updateFilters(chip.clear)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {activeChips.length > 1 && (
                <button type="button" className="link-button" onClick={() => updateFilters(NO_FILTERS)}>
                  Clear all
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && !showForm && <p className="error">{error}</p>}
      {!projects && !error && <p className="muted">Loading…</p>}
      {projects && projects.length === 0 && <p className="muted">No projects yet.</p>}
      {projects && projects.length > 0 && visibleProjects.length === 0 && (
        <p className="muted">No projects match these filters.</p>
      )}

      <div className="list">
        {visibleProjects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="list-item project-row">
            <div className="list-item-info">
              <div className="title">{p.name}</div>
              {canSeeCompanyInfo && (
                <div className="muted project-meta">
                  {p.company} <span className="key-tag">Co.{p.company_id}</span> / {p.department}{' '}
                  <span className="key-tag">Dept.{p.department_id}</span>
                  {p.sub_department && (
                    <>
                      {' / '}
                      {p.sub_department} <span className="key-tag">Sub.{p.sub_department_id}</span>
                    </>
                  )}
                </div>
              )}
              {p.description && <div className="muted project-meta multiline project-description">{p.description}</div>}
            </div>
            {insightsOn && <CardInsights project={p} insights={insights[p.id]} />}
            <div className="project-status-col">
              <StatusBadge status={p.status} />
              {insightsOn && commencementDate(p) && (
                <div className="muted project-owner">Commenced: {formatDate(commencementDate(p))}</div>
              )}
              {p.current_rollout_date && (
                <div className="muted project-owner">Rollout: {formatDate(p.current_rollout_date)}</div>
              )}
              {p.responsible_person && (
                <div className="muted project-owner">RESP: {p.responsible_person}</div>
              )}
              {p.assigned_by && (
                <div className="muted project-owner">Assigned By: {p.assigned_by}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
