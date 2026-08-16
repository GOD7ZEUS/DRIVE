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

  return (
    <div>
      <div className="row-between">
        <h1>Companies</h1>
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
      <p className="muted" style={{ marginBottom: 16 }}>
        {isProAdmin
          ? 'Your company and its departments — add departments here as needed.'
          : 'Add companies and departments here first — Projects and Users then just pick from what already exists.'}
      </p>

      {!isProAdmin && showCompanyForm && (
        <form className="panel inline-form" onSubmit={handleAddCompany} style={{ marginBottom: 20 }}>
          <input
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
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

      <div className="list">
        {companies?.map((c) => (
          <div key={c.id}>
            {editingCompanyId === c.id ? (
              <form
                className="panel inline-form"
                onSubmit={(e) => handleSaveCompanyEdit(e, c.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ marginBottom: 8 }}
              >
                <input
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
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
                {editCompanyError && <p className="error">{editCompanyError}</p>}
              </form>
            ) : (
              <div className="list-item" onClick={() => toggleCompany(c)} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="title">
                    {c.name} <span className="key-tag">Co.{c.id}</span>{' '}
                    {!!c.is_private && <span className="key-tag">PRIVATE</span>}
                  </div>
                  <div className="muted">
                    {c.department_count} department{c.department_count === 1 ? '' : 's'} ·{' '}
                    {c.project_count} project{c.project_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="row">
                  <button onClick={(e) => startEditCompany(e, c)}>Edit</button>
                  <span className="muted">{expandedId === c.id ? '▲' : '▼'}</span>
                </div>
              </div>
            )}

            {expandedId === c.id && (
              <div className="panel" style={{ marginTop: 8, marginBottom: 8 }}>
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
                      placeholder="Department name"
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
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
                <div className="list">
                  {departments?.map((d) =>
                    editingDeptId === d.id ? (
                      <form
                        key={d.id}
                        className="inline-form panel"
                        onSubmit={(e) => handleSaveDeptEdit(e, c, d.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginBottom: 4 }}
                      >
                        <input
                          value={editDeptName}
                          onChange={(e) => setEditDeptName(e.target.value)}
                          required
                          autoFocus
                        />
                        <button type="submit" className="primary">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingDeptId(null)}>
                          Cancel
                        </button>
                        {editDeptError && <p className="error">{editDeptError}</p>}
                      </form>
                    ) : (
                      <div
                        key={d.id}
                        className="list-item"
                        onClick={() => goToProjects(c, d)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <div className="title">
                            {d.name} <span className="key-tag">Dept.{d.id}</span>
                          </div>
                          <div className="muted">
                            {d.project_count} project{d.project_count === 1 ? '' : 's'}
                          </div>
                        </div>
                        <button onClick={(e) => startEditDept(e, d)}>Edit</button>
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
