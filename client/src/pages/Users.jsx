import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import CompanyDepartmentFields from '../components/CompanyDepartmentFields.jsx';
import { formatUserName } from '../userDisplay.js';

const ROLE_LABELS = { super_admin: 'Super Admin', pro_admin: 'Pro Admin', admin: 'Admin', view: 'View' };

export default function Users() {
  const { user: currentUser } = useAuth();
  const isMaster = !!currentUser.is_master;
  const roles = isMaster ? ['admin', 'view', 'super_admin', 'pro_admin'] : ['admin', 'view'];
  const [proAdminCompanies, setProAdminCompanies] = useState(null);

  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('view');
  const [company, setCompany] = useState('');
  const [department, setDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editRole, setEditRole] = useState('view');
  const [editCompany, setEditCompany] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  function load() {
    api.getUsers().then(setUsers).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!isMaster) return;
    if (role === 'pro_admin' || editRole === 'pro_admin') {
      api.getCompanies().then(setProAdminCompanies).catch(() => setProAdminCompanies([]));
    }
  }, [isMaster, role, editRole]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.createUser({
        email,
        password,
        role,
        company,
        department,
        first_name: firstName,
        last_name: lastName,
      });
      setFirstName('');
      setLastName('');
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

  function startEditUser(u) {
    setEditingUserId(u.id);
    setEditFirstName(u.first_name || '');
    setEditLastName(u.last_name || '');
    setEditRole(u.role);
    setEditCompany(u.company || '');
    setEditDepartment(u.department || '');
    setEditPassword('');
    setEditError('');
  }

  async function handleSaveUserEdit(e) {
    e.preventDefault();
    setEditError('');
    setEditSubmitting(true);
    try {
      const payload = {
        first_name: editFirstName,
        last_name: editLastName,
        role: editRole,
      };
      if (editRole !== 'super_admin') {
        payload.company = editCompany;
        payload.department = editDepartment;
      }
      if (editPassword) payload.password = editPassword;
      await api.updateUser(editingUserId, payload);
      setEditingUserId(null);
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSubmitting(false);
    }
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
            First Name
            <br />
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
          </label>
          <label>
            Last Name
            <br />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
          <label>
            Email
            <br />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {role === 'super_admin' ? (
            <p className="muted">Super Admin accounts aren't tied to a company/department — they see everything.</p>
          ) : role === 'pro_admin' ? (
            <>
              <label>
                Company
                <br />
                <select value={company} onChange={(e) => setCompany(e.target.value)} required>
                  <option value="" disabled>
                    {proAdminCompanies ? 'Select a company…' : 'Loading…'}
                  </option>
                  {proAdminCompanies?.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                This Pro Admin will have full control over every department, user, and project in this company.
              </p>
            </>
          ) : (
            <>
              <CompanyDepartmentFields
                company={company}
                department={department}
                onCompanyChange={setCompany}
                onDepartmentChange={setDepartment}
              />
              <p className="muted">
                This account will only see projects tagged with this Company + Department.
              </p>
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

      {!showForm && error && <p className="error">{error}</p>}
      {!users && !error && <p className="muted">Loading…</p>}

      <div className="list">
        {users?.map((u) => {
          const canManage = !u.is_master && (isMaster || (u.role !== 'super_admin' && u.role !== 'pro_admin'));
          if (editingUserId === u.id) {
            return (
              <form
                key={u.id}
                className="panel form-grid"
                onSubmit={handleSaveUserEdit}
                style={{ marginBottom: 4 }}
              >
                <label>
                  First Name
                  <br />
                  <input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} required autoFocus />
                </label>
                <label>
                  Last Name
                  <br />
                  <input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} required />
                </label>
                <label>
                  Role
                  <br />
                  <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                {editRole === 'super_admin' ? (
                  <p className="muted">Super Admin accounts aren't tied to a company/department.</p>
                ) : editRole === 'pro_admin' ? (
                  <label>
                    Company
                    <br />
                    <select value={editCompany} onChange={(e) => setEditCompany(e.target.value)} required>
                      <option value="" disabled>
                        {proAdminCompanies ? 'Select a company…' : 'Loading…'}
                      </option>
                      {proAdminCompanies?.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <CompanyDepartmentFields
                    company={editCompany}
                    department={editDepartment}
                    onCompanyChange={setEditCompany}
                    onDepartmentChange={setEditDepartment}
                    initialCompany={u.company}
                    initialDepartment={u.department}
                  />
                )}
                <label>
                  New Password
                  <br />
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                    minLength={6}
                  />
                </label>
                {editError && <p className="error">{editError}</p>}
                <div className="row">
                  <button type="submit" className="primary" disabled={editSubmitting}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingUserId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            );
          }
          return (
            <div key={u.id} className="list-item">
              <div>
                <div className="title">
                  {formatUserName(u)} {u.is_master && <span className="key-tag">MASTER</span>}
                </div>
                <div className="muted">
                  {u.email} · {ROLE_LABELS[u.role]}
                  {u.company && (
                    <>
                      {' · '}
                      {u.company} <span className="key-tag">Co.{u.company_id}</span>
                      {u.department && (
                        <>
                          {' / '}
                          {u.department} <span className="key-tag">Dept.{u.department_id}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {canManage && (
                <div className="row">
                  <button onClick={() => startEditUser(u)}>Edit</button>
                  <button className="danger" onClick={() => handleDelete(u)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
