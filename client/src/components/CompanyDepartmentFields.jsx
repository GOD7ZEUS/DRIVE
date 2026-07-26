import { useEffect, useState } from 'react';
import { api } from '../api.js';

const NEW_OPTION = '__new__';

export default function CompanyDepartmentFields({ company, department, onCompanyChange, onDepartmentChange }) {
  const [companies, setCompanies] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const [companyIsNew, setCompanyIsNew] = useState(false);

  const [departments, setDepartments] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [departmentIsNew, setDepartmentIsNew] = useState(false);

  useEffect(() => {
    api.getCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  function resetDepartment() {
    setDepartments(null);
    setDepartmentId('');
    setDepartmentIsNew(false);
    onDepartmentChange('');
  }

  function handleCompanySelect(value) {
    if (value === NEW_OPTION) {
      setCompanyIsNew(true);
      setCompanyId('');
      onCompanyChange('');
      resetDepartment();
      setDepartmentIsNew(true);
      return;
    }
    setCompanyIsNew(false);
    setCompanyId(value);
    resetDepartment();
    const selected = companies.find((c) => String(c.id) === value);
    onCompanyChange(selected ? selected.name : '');
    api.getCompanyDepartments(value).then(setDepartments).catch(() => setDepartments([]));
  }

  function handleUseNewCompany() {
    setCompanyIsNew(false);
    setCompanyId('');
    onCompanyChange('');
    resetDepartment();
  }

  function handleDepartmentSelect(value) {
    if (value === NEW_OPTION) {
      setDepartmentIsNew(true);
      setDepartmentId('');
      onDepartmentChange('');
      return;
    }
    setDepartmentId(value);
    const selected = departments.find((d) => String(d.id) === value);
    onDepartmentChange(selected ? selected.name : '');
  }

  const showCompanyInput = companyIsNew || (companies && companies.length === 0);
  const showDepartmentInput = departmentIsNew || (departments && departments.length === 0);

  return (
    <>
      <label>
        Company
        <br />
        {showCompanyInput ? (
          <input
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder="New company name"
            required
            autoFocus
          />
        ) : (
          <select value={companyId} onChange={(e) => handleCompanySelect(e.target.value)} required>
            <option value="" disabled>
              {companies ? 'Select a company…' : 'Loading…'}
            </option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_OPTION}>+ Add new company</option>
          </select>
        )}
        {companyIsNew && companies && companies.length > 0 && (
          <button type="button" onClick={handleUseNewCompany} style={{ marginTop: 6 }}>
            Choose existing instead
          </button>
        )}
      </label>

      <label>
        Department
        <br />
        {!company ? (
          <input value="" placeholder="Pick a company first" disabled />
        ) : showDepartmentInput ? (
          <input
            value={department}
            onChange={(e) => onDepartmentChange(e.target.value)}
            placeholder="New department name"
            required
          />
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
            <option value={NEW_OPTION}>+ Add new department</option>
          </select>
        )}
      </label>
    </>
  );
}
