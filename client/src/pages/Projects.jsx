import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import CompanyDepartmentFields from '../components/CompanyDepartmentFields.jsx';
import { formatUserName } from '../userDisplay.js';
import { formatDate } from '../dateFormat.js';

const STATUSES = ['planning', 'active', 'on_hold', 'completed'];

export default function Projects() {
  const { user } = useAuth();
  const isSuperAdmin = user.role === 'super_admin';
  const isProAdmin = user.role === 'pro_admin';
  const canPickCompany = isSuperAdmin || isProAdmin;
  const canEdit = user.role !== 'view';
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planning');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [ownDepartments, setOwnDepartments] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [companyFilter, setCompanyFilter] = useState(searchParams.get('companyId') || 'all');
  const [departmentFilter, setDepartmentFilter] = useState(searchParams.get('departmentId') || 'all');

  function load() {
    api.getProjects().then(setProjects).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!showForm) return;
    api.getAllAssignableUsers().then(setAssignableUsers).catch(() => setAssignableUsers([]));
    if (isProAdmin) {
      api.getCompanyDepartments(user.company_id).then(setOwnDepartments).catch(() => setOwnDepartments([]));
    }
  }, [showForm, isProAdmin, user.company_id]);

  const companies = useMemo(() => {
    if (!projects) return [];
    const byId = new Map();
    for (const p of projects) {
      if (p.company_id) byId.set(p.company_id, p.company);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [projects]);

  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    if (!canPickCompany) return projects;
    return projects.filter((p) => {
      if (companyFilter !== 'all' && String(p.company_id) !== companyFilter) return false;
      if (departmentFilter !== 'all' && String(p.department_id) !== departmentFilter) return false;
      return true;
    });
  }, [projects, companyFilter, departmentFilter, canPickCompany]);

  function handleCompanyFilterChange(value) {
    setCompanyFilter(value);
    setDepartmentFilter('all');
    setSearchParams(value === 'all' ? {} : { companyId: value });
  }

  function clearFilter() {
    setCompanyFilter('all');
    setDepartmentFilter('all');
    setSearchParams({});
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
      if (canPickCompany) {
        payload.company = company;
        payload.department = department;
      }
      await api.createProject(payload);
      setName('');
      setDescription('');
      setStatus('planning');
      setResponsibleUserId('');
      setCompany('');
      setDepartment('');
      setAssignableUsers([]);
      setShowForm(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const filteredDepartmentName =
    departmentFilter !== 'all' ? projects?.find((p) => String(p.department_id) === departmentFilter)?.department : null;

  return (
    <div>
      <div className="row-between">
        <h1>Projects</h1>
        <div className="row">
          {canPickCompany && projects && projects.length > 0 && (
            <select value={companyFilter} onChange={(e) => handleCompanyFilterChange(e.target.value)}>
              <option value="all">All companies</option>
              {companies.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {canEdit && (
            <button className="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? 'Cancel' : 'New Project'}
            </button>
          )}
        </div>
      </div>

      {canPickCompany && departmentFilter !== 'all' && filteredDepartmentName && (
        <p className="muted" style={{ marginBottom: 12 }}>
          Filtered to department <strong>{filteredDepartmentName}</strong> ·{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); clearFilter(); }}>
            clear
          </a>
        </p>
      )}

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
                  {s}
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
          {isSuperAdmin ? (
            <CompanyDepartmentFields
              company={company}
              department={department}
              onCompanyChange={setCompany}
              onDepartmentChange={setDepartment}
            />
          ) : isProAdmin ? (
            <label>
              Department
              <br />
              <select value={department} onChange={(e) => setDepartment(e.target.value)} required>
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
          ) : (
            <p className="muted">
              Will be created under <strong>{user.company}</strong> / <strong>{user.department}</strong>
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div>
            <button type="submit" className="primary" disabled={submitting}>
              Create
            </button>
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {!projects && !error && <p className="muted">Loading…</p>}
      {projects && projects.length === 0 && <p className="muted">No projects yet.</p>}
      {projects && projects.length > 0 && visibleProjects.length === 0 && (
        <p className="muted">No projects match this filter.</p>
      )}

      <div className="list">
        {visibleProjects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="list-item project-row">
            <div className="list-item-info">
              <div className="title">{p.name}</div>
              {canPickCompany && (
                <div className="muted project-meta">
                  {p.company} <span className="key-tag">Co.{p.company_id}</span> / {p.department}{' '}
                  <span className="key-tag">Dept.{p.department_id}</span>
                </div>
              )}
              {p.description && <div className="muted project-meta">{p.description}</div>}
            </div>
            <div className="project-status-col">
              <StatusBadge status={p.status} />
              {(p.responsible_person || p.current_rollout_date) && (
                <div className="muted project-owner">
                  {p.responsible_person && `Owner: ${p.responsible_person}`}
                  {p.responsible_person && p.current_rollout_date && ' · '}
                  {p.current_rollout_date && `Rollout: ${formatDate(p.current_rollout_date)}`}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
