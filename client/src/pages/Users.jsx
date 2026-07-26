import { useEffect, useState } from 'react';
import { api } from '../api.js';
import CompanyDepartmentFields from '../components/CompanyDepartmentFields.jsx';

const ROLES = ['admin', 'view'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', view: 'View' };

export default function Users() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('view');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.getUsers().then(setUsers).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.createUser({ email, password, role, company, department });
      setEmail('');
      setPassword('');
      setRole('view');
      setCompany('');
      setDepartment('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(u) {
    if (!confirm(`Delete account "${u.email}"?`)) return;
    await api.deleteUser(u.id);
    load();
  }

  return (
    <div>
      <div className="row-between">
        <h1>Users</h1>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New Account'}
        </button>
      </div>

      {showForm && (
        <form className="panel form-grid" onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
          <label>
            Email
            <br />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label>
            Password
            <br />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label>
            Role
            <br />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <CompanyDepartmentFields
            company={company}
            department={department}
            onCompanyChange={setCompany}
            onDepartmentChange={setDepartment}
          />
          <p className="muted">
            This account will only see projects tagged with this Company + Department.
          </p>
          {error && <p className="error">{error}</p>}
          <div>
            <button type="submit" className="primary" disabled={submitting}>
              Create
            </button>
          </div>
        </form>
      )}

      {!showForm && error && <p className="error">{error}</p>}
      {!users && !error && <p className="muted">Loading…</p>}

      <div className="list">
        {users?.map((u) => (
          <div key={u.id} className="list-item">
            <div>
              <div className="title">{u.email}</div>
              <div className="muted">
                {ROLE_LABELS[u.role]}
                {u.company && (
                  <>
                    {' · '}
                    {u.company} <span className="key-tag">Co.{u.company_id}</span> / {u.department}{' '}
                    <span className="key-tag">Dept.{u.department_id}</span>
                  </>
                )}
              </div>
            </div>
            {u.role !== 'super_admin' && (
              <button className="danger" onClick={() => handleDelete(u)}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
