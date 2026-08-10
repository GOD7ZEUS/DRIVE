import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function CompanyDepartmentFields({
  company,
  department,
  onCompanyChange,
  onDepartmentChange,
  onIdsChange,
  initialCompany,
  initialDepartment,
}) {
  const [companies, setCompanies] = useState(null);
  const [companyId, setCompanyId] = useState('');

  const [departments, setDepartments] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [preselected, setPreselected] = useState(false);

  useEffect(() => {
    api.getCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  // Edit forms pass the record's current company/department name so the
  // pickers start pre-selected instead of forcing a reselect from scratch;
  // new-record forms simply don't pass these and nothing here runs.
  useEffect(() => {
    if (!companies || preselected || !initialCompany) return;
    setPreselected(true);
    const match = companies.find((c) => c.name === initialCompany);
    if (!match) return;
    setCompanyId(String(match.id));
    onCompanyChange(match.name);
    api
      .getCompanyDepartments(match.id)
      .then((depts) => {
        setDepartments(depts);
        const deptMatch = depts.find((d) => d.name === initialDepartment);
        if (deptMatch) {
          setDepartmentId(String(deptMatch.id));
          onDepartmentChange(deptMatch.name);
        }
        onIdsChange?.(match.id, deptMatch ? deptMatch.id : null);
      })
      .catch(() => setDepartments([]));
  }, [companies, preselected, initialCompany, initialDepartment]);

  function handleCompanySelect(value) {
    setCompanyId(value);
    setDepartments(null);
    setDepartmentId('');
    onDepartmentChange('');
    const selected = companies.find((c) => String(c.id) === value);
    onCompanyChange(selected ? selected.name : '');
    onIdsChange?.(value ? Number(value) : null, null);
    if (value) api.getCompanyDepartments(value).then(setDepartments).catch(() => setDepartments([]));
  }

  function handleDepartmentSelect(value) {
    setDepartmentId(value);
    const selected = departments.find((d) => String(d.id) === value);
    onDepartmentChange(selected ? selected.name : '');
    onIdsChange?.(companyId ? Number(companyId) : null, value ? Number(value) : null);
  }

  if (companies && companies.length === 0) {
    return (
      <p className="muted">
        No companies exist yet. <Link to="/companies">Add one on the Companies page</Link> first.
      </p>
    );
  }

  return (
    <>
      <label>
        Company
        <br />
        <select value={companyId} onChange={(e) => handleCompanySelect(e.target.value)} required>
          <option value="" disabled>
            {companies ? 'Select a company…' : 'Loading…'}
          </option>
          {companies?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Department
        <br />
        {!companyId ? (
          <input value="" placeholder="Pick a company first" disabled />
        ) : departments && departments.length === 0 ? (
          <p className="muted">
            No departments in this company yet. <Link to="/companies">Add one on the Companies page</Link>.
          </p>
        ) : (
          <select value={departmentId} onChange={(e) => handleDepartmentSelect(e.target.value)} required>
            <option value="" disabled>
              {departments ? 'Select a department…' : 'Loading…'}
            </option>
            {departments?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </label>
    </>
  );
}
