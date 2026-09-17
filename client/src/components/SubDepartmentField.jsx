import { useEffect, useState } from 'react';
import { api } from '../api.js';

const NEW_OPTION = '__new__';

// Unlike Company/Department, sub-departments have no management page of
// their own — this field is the only place one is ever picked or created,
// so (unlike CompanyDepartmentFields) it lets you type a brand new name
// right here instead of requiring it to already exist.
export default function SubDepartmentField({ departmentId, value, onChange, initialSubDepartment }) {
  const [subDepartments, setSubDepartments] = useState(null);
  const [mode, setMode] = useState('pick');
  const [pickedId, setPickedId] = useState('');
  const [preselected, setPreselected] = useState(false);

  useEffect(() => {
    setSubDepartments(null);
    setPickedId('');
    setMode('pick');
    setPreselected(false);
    if (!departmentId) return;
    api.getSubDepartments(departmentId).then(setSubDepartments).catch(() => setSubDepartments([]));
  }, [departmentId]);

  // Edit forms pass the project's current sub-department name so the field
  // starts pre-selected (or pre-filled, if it's since been deleted) instead
  // of forcing a reselect from scratch.
  useEffect(() => {
    if (!subDepartments || preselected || !initialSubDepartment) return;
    setPreselected(true);
    const match = subDepartments.find((d) => d.name === initialSubDepartment);
    if (match) {
      setPickedId(String(match.id));
    } else {
      setMode('new');
      onChange(initialSubDepartment);
    }
  }, [subDepartments, preselected, initialSubDepartment]);

  function handlePick(v) {
    if (v === NEW_OPTION) {
      setMode('new');
      setPickedId('');
      onChange('');
      return;
    }
    setPickedId(v);
    const match = subDepartments.find((d) => String(d.id) === v);
    onChange(match ? match.name : '');
  }

  if (!departmentId) return null;

  return (
    <label>
      Sub Department (optional)
      <br />
      {mode === 'new' ? (
        <span className="row" style={{ gap: 6 }}>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="New sub-department name"
            autoFocus
          />
          {subDepartments && subDepartments.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMode('pick');
                setPickedId('');
                onChange('');
              }}
            >
              Pick existing
            </button>
          )}
        </span>
      ) : (
        <select value={pickedId} onChange={(e) => handlePick(e.target.value)}>
          <option value="">
            {subDepartments ? 'None' : 'Loading…'}
          </option>
          {subDepartments?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={NEW_OPTION}>+ Add new sub-department…</option>
        </select>
      )}
    </label>
  );
}
