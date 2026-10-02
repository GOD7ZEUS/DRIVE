import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Companies() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMaster = !!user.is_master;
  const isProAdmin = user.role === 'pro_admin';
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [departments, setDepartments] = useState(null);
  const [departmentsError, setDepartmentsError] = useState('');

  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyPrivate, setCompanyPrivate] = useState(false);
  const [companyError, setCompanyError] = useState('');
  const [submittingCompany, setSubmittingCompany] = useState(false);

  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptError, setDeptError] = useState('');
  const [submittingDept, setSubmittingDept] = useState(false);

  const [editingCompanyId, setEditingCompanyId] = useState(null);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editCompanyPrivate, setEditCompanyPrivate] = useState(false);
  const [editCompanyError, setEditCompanyError] = useState('');

  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editDeptName, setEditDeptName] = useState('');
  const [editDeptError, setEditDeptError] = useState('');
  const [search, setSearch] = useState('');

  function load() {
    api.getCompanies().then(setCompanies).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function toggleCompany(company) {
    setShowDeptForm(false);
    if (expandedId === company.id) {
      setExpandedId(null);
      setDepartments(null);
      return;
    }
    setExpandedId(company.id);
    setDepartments(null);
    setDepartmentsError('');
    try {
      const rows = await api.getCompanyDepartments(company.id);
      setDepartments(rows);
    } catch (e) {
      setDepartmentsError(e.message);
    }
  }

  function goToProjects(company, department) {
    navigate(`/projects?companyId=${company.id}&departmentId=${department.id}`);
  }

  async function handleAddCompany(e) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setSubmittingCompany(true);
    setCompanyError('');
    try {
      await api.createCompany(companyName, companyPrivate);
      setCompanyName('');
      setCompanyPrivate(false);
      setShowCompanyForm(false);
      load();
    } catch (e) {
      setCompanyError(e.message);
    } finally {
      setSubmittingCompany(false);
    }
  }

  async function handleAddDepartment(e, company) {
    e.preventDefault();
    if (!deptName.trim()) return;
    setSubmittingDept(true);
    setDeptError('');
    try {
      await api.createDepartment(company.id, deptName);
      setDeptName('');
      setShowDeptForm(false);
      load();
      const rows = await api.getCompanyDepartments(company.id);
      setDepartments(rows);
    } catch (e) {
      setDeptError(e.message);
    } finally {
      setSubmittingDept(false);
    }
  }

  function startEditCompany(e, company) {
    e.stopPropagation();
    setEditingCompanyId(company.id);
    setEditCompanyName(company.name);
    setEditCompanyPrivate(!!company.is_private);
    setEditCompanyError('');
  }

  async function handleSaveCompanyEdit(e, companyId) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const payload = { name: editCompanyName };
      if (isMaster) payload.is_private = editCompanyPrivate;
      await api.updateCompany(companyId, payload);
      setEditingCompanyId(null);
      load();
    } catch (err) {
      setEditCompanyError(err.message);
    }
  }

  async function handleDeleteCompany(e, company) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete company "${company.name}"? This can't be undone.`)) return;
    try {
      await api.deleteCompany(company.id);
      setEditingCompanyId(null);
      if (expandedId === company.id) {
        setExpandedId(null);
        setDepartments(null);
      }
      load();
    } catch (err) {
      setEditCompanyError(err.message);
    }
  }

  function startEditDept(e, dept) {
    e.stopPropagation();
    setEditingDeptId(dept.id);
    setEditDeptName(dept.name);
    setEditDeptError('');
  }

  async function handleSaveDeptEdit(e, company, deptId) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.updateDepartment(company.id, deptId, editDeptName);
      setEditingDeptId(null);
      const rows = await api.getCompanyDepartments(company.id);
      setDepartments(rows);
      load();
    } catch (err) {
      setEditDeptError(err.message);
    }
  }

  async function handleDeleteDept(e, company, dept) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete department "${dept.name}"? This can't be undone.`)) return;
    try {
      await api.deleteDepartment(company.id, dept.id);
      setEditingDeptId(null);
      const rows = await api.getCompanyDepartments(company.id);
      setDepartments(rows);
      load();
    } catch (err) {
      setEditDeptError(err.message);
    }
  }

  const totals = (companies || []).reduce(
    (acc, c) => ({ departments: acc.departments + c.department_count, projects: acc.projects + c.project_count }),
    { departments: 0, projects: 0 }
  );
  const query = search.trim().toLowerCase();
  const visibleCompanies = (companies || []).filter((c) => !query || c.name.toLowerCase().includes(query));

  return (
    <div>
      <div className="row-between page-header">
        <div>
          <h1>Companies</h1>
          {companies && (
            <p className="muted page-subtitle">
              {companies.length} {companies.length === 1 ? 'company' : 'companies'} · {totals.departments}{' '}
              {totals.departments === 1 ? 'department' : 'departments'} · {totals.projects}{' '}
              {totals.projects === 1 ? 'project' : 'projects'}
            </p>
          )}
        </div>
        {!isProAdmin && (
          <button
            className="primary"
            onClick={() => {
              setShowCompanyForm((s) => !s);
              setCompanyError('');
            }}
          >
            {showCompanyForm ? 'Cancel' : 'New Company'}
          </button>
        )}
      </div>

      {!isProAdmin && showCompanyForm && (
        <form className="panel inline-form" onSubmit={handleAddCompany} style={{ marginBottom: 20 }}>
          <input
            placeholder="COMPANY NAME"
            className="uppercase-input"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value.toUpperCase())}
            required
            autoFocus
          />
          {isMaster && (
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={companyPrivate}
                onChange={(e) => setCompanyPrivate(e.target.checked)}
              />
              Keep this private (only visible to you)
            </label>
          )}
          <button type="submit" className="primary" disabled={submittingCompany}>
            {submittingCompany ? 'Adding…' : 'Add'}
          </button>
          {companyError && <p className="error">{companyError}</p>}
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {!companies && !error && <p className="muted">Loading…</p>}
      {companies && companies.length === 0 && <p className="muted">No companies yet — add one above.</p>}

      {companies && companies.length > 1 && (
        <div className="list-toolbar">
          <input
            type="search"
            className="list-search"
            placeholder="Search companies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search companies"
          />
        </div>
      )}
      {companies && companies.length > 0 && visibleCompanies.length === 0 && (
        <p className="muted">No companies match.</p>
      )}

      <div className="company-list">
        {visibleCompanies.map((c) => (
          <div key={c.id} className={`panel company-card${expandedId === c.id ? ' expanded' : ''}`}>
            {editingCompanyId === c.id ? (
              <form
                className="inline-form"
                onSubmit={(e) => handleSaveCompanyEdit(e, c.id)}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  className="uppercase-input"
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value.toUpperCase())}
                  required
                  autoFocus
                />
                {isMaster && (
                  <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editCompanyPrivate}
                      onChange={(e) => setEditCompanyPrivate(e.target.checked)}
                    />
                    Private (only visible to you)
                  </label>
                )}
                <button type="submit" className="primary">
                  Save
                </button>
                <button type="button" onClick={() => setEditingCompanyId(null)}>
                  Cancel
                </button>
                {isMaster && (
                  <button type="button" className="danger" onClick={(e) => handleDeleteCompany(e, c)}>
                    Delete Company
                  </button>
                )}
                {editCompanyError && <p className="error">{editCompanyError}</p>}
              </form>
            ) : (
              <div
                className="company-card-head"
                role="button"
                tabIndex={0}
                aria-expanded={expandedId === c.id}
                onClick={() => toggleCompany(c)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCompany(c);
                  }
                }}
              >
                <div className="company-avatar" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </div>
                <div className="company-name">
                  <div className="title">
                    {c.name} <span className="key-tag">Co.{c.id}</span>{' '}
                    {!!c.is_private && <span className="key-tag">PRIVATE</span>}
                  </div>
                  <div className="company-stats">
                    <span className="stat-pill">
                      <strong>{c.department_count}</strong> {c.department_count === 1 ? 'department' : 'departments'}
                    </span>
                    <span className="stat-pill">
                      <strong>{c.project_count}</strong> {c.project_count === 1 ? 'project' : 'projects'}
                    </span>
                  </div>
                </div>
                <div className="row">
                  <button onClick={(e) => startEditCompany(e, c)}>Edit</button>
                  <span className="chevron" aria-hidden="true">
                    {expandedId === c.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>
            )}

            {expandedId === c.id && (
              <div className="company-card-body">
                <div className="row-between">
                  <strong>Departments</strong>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeptForm((s) => !s);
                      setDeptError('');
                    }}
                  >
                    {showDeptForm ? 'Cancel' : 'Add Department'}
                  </button>
                </div>

                {showDeptForm && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => handleAddDepartment(e, c)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ margin: '12px 0' }}
                  >
                    <input
                      placeholder="DEPARTMENT NAME"
                      className="uppercase-input"
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value.toUpperCase())}
                      required
                      autoFocus
                    />
                    <button type="submit" className="primary" disabled={submittingDept}>
                      {submittingDept ? 'Adding…' : 'Add'}
                    </button>
                    {deptError && <p className="error">{deptError}</p>}
                  </form>
                )}

                {departmentsError && <p className="error">{departmentsError}</p>}
                {!departments && !departmentsError && <p className="muted">Loading departments…</p>}
                {departments && departments.length === 0 && <p className="muted">No departments yet.</p>}
                <div className="department-grid">
                  {departments?.map((d) =>
                    editingDeptId === d.id ? (
                      <form
                        key={d.id}
                        className="department-tile editing"
                        onSubmit={(e) => handleSaveDeptEdit(e, c, d.id)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="uppercase-input"
                          value={editDeptName}
                          onChange={(e) => setEditDeptName(e.target.value.toUpperCase())}
                          required
                          autoFocus
                        />
                        <div className="row">
                          <button type="submit" className="primary">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingDeptId(null)}>
                            Cancel
                          </button>
                          {isMaster && (
                            <button type="button" className="danger" onClick={(e) => handleDeleteDept(e, c, d)}>
                              Delete
                            </button>
                          )}
                        </div>
                        {editDeptError && <p className="error">{editDeptError}</p>}
                      </form>
                    ) : (
                      <div key={d.id} className="department-tile">
                        <div className="title">
                          {d.name} <span className="key-tag">Dept.{d.id}</span>
                        </div>
                        <div className="muted">
                          {d.project_count} {d.project_count === 1 ? 'project' : 'projects'}
                        </div>
                        <div className="row department-tile-actions">
                          <button type="button" className="link-button" onClick={() => goToProjects(c, d)}>
                            View projects →
                          </button>
                          <button onClick={(e) => startEditDept(e, d)}>Edit</button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
