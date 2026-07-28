import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Companies() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [departments, setDepartments] = useState(null);
  const [departmentsError, setDepartmentsError] = useState('');

  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyError, setCompanyError] = useState('');
  const [submittingCompany, setSubmittingCompany] = useState(false);

  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptError, setDeptError] = useState('');
  const [submittingDept, setSubmittingDept] = useState(false);

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
      await api.createCompany(companyName);
      setCompanyName('');
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

  return (
    <div>
      <div className="row-between">
        <h1>Companies</h1>
        <button
          className="primary"
          onClick={() => {
            setShowCompanyForm((s) => !s);
            setCompanyError('');
          }}
        >
          {showCompanyForm ? 'Cancel' : 'New Company'}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Add companies and departments here first — Projects and Users then just pick from what already exists.
      </p>

      {showCompanyForm && (
        <form className="panel inline-form" onSubmit={handleAddCompany} style={{ marginBottom: 20 }}>
          <input
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            autoFocus
          />
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
            <div className="list-item" onClick={() => toggleCompany(c)} style={{ cursor: 'pointer' }}>
              <div>
                <div className="title">
                  {c.name} <span className="key-tag">Co.{c.id}</span>
                </div>
                <div className="muted">
                  {c.department_count} department{c.department_count === 1 ? '' : 's'} ·{' '}
                  {c.project_count} project{c.project_count === 1 ? '' : 's'}
                </div>
              </div>
              <span className="muted">{expandedId === c.id ? '▲' : '▼'}</span>
            </div>

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
                  {departments?.map((d) => (
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
