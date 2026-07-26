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

  useEffect(() => {
    api.getCompanies().then(setCompanies).catch((e) => setError(e.message));
  }, []);

  async function toggleCompany(company) {
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

  return (
    <div>
      <h1>Companies</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Pick a company, then a department, to jump straight to its projects.
      </p>

      {error && <p className="error">{error}</p>}
      {!companies && !error && <p className="muted">Loading…</p>}
      {companies && companies.length === 0 && (
        <p className="muted">No companies yet — one gets created automatically the first time you add an account or project.</p>
      )}

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
