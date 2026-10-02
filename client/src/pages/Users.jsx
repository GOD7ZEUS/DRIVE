import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import CompanyDepartmentFields from '../components/CompanyDepartmentFields.jsx';
import { formatUserName } from '../userDisplay.js';

const ROLE_LABELS = { super_admin: 'Super Admin', pro_admin: 'Pro Admin', admin: 'Admin', view: 'View' };
const ROLE_ORDER = ['super_admin', 'pro_admin', 'admin', 'view'];

function initials(u) {
  const fromName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  const source = fromName || u.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const isMaster = !!currentUser.is_master;
  const roles = isMaster ? ['admin', 'view', 'super_admin', 'pro_admin'] : ['admin', 'view'];
  const [proAdminCompanies, setProAdminCompanies] = useState(null);

  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [rowError, setRowError] = useState({});
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
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

  const roleCounts = useMemo(() => {
    const counts = { all: users?.length || 0 };
    for (const r of ROLE_ORDER) counts[r] = users?.filter((u) => u.role === r).length || 0;
    return counts;
  }, [users]);

  const visibleUsers = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return [formatUserName(u), u.email, u.company, u.department].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [users, search, roleFilter]);

  const insightsGranted = users?.filter((u) => !u.is_master && u.can_view_insights).length || 0;

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
    setRowError((prev) => ({ ...prev, [u.id]: '' }));
    try {
      await api.deleteUser(u.id);
      load();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [u.id]: err.message }));
    }
  }

  // Optimistic: flip the switch immediately, put it back if the save fails.
  async function handleInsightsToggle(u, enabled) {
    setRowError((prev) => ({ ...prev, [u.id]: '' }));
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, can_view_insights: enabled ? 1 : 0 } : x)));
    try {
      await api.setUserInsightsAccess(u.id, enabled);
    } catch (err) {
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, can_view_insights: enabled ? 0 : 1 } : x)));
      setRowError((prev) => ({ ...prev, [u.id]: err.message }));
    }
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
      <div className="row-between page-header">
        <div>
          <h1>Users</h1>
          {users && (
            <p className="muted page-subtitle">
              {users.length} {users.length === 1 ? 'account' : 'accounts'}
              {isMaster && ` · insights enabled for ${insightsGranted}`}
            </p>
          )}
        </div>
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
                {role === 'view'
                  ? 'View accounts can see every company and department, read-only.'
                  : 'This account will only see projects tagged with this Company + Department.'}
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

      {users && users.length > 0 && (
        <div className="list-toolbar">
          <div className="status-tabs">
            {['all', ...ROLE_ORDER].map((r) => (
              <button
                key={r}
                type="button"
                className={roleFilter === r ? 'active' : ''}
                onClick={() => setRoleFilter(r)}
              >
                {r === 'all' ? 'All' : ROLE_LABELS[r]} <span className="muted">({roleCounts[r]})</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            className="list-search"
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
      )}

      {users && users.length > 0 && visibleUsers.length === 0 && <p className="muted">No accounts match.</p>}

      <div className="user-list">
        {visibleUsers.map((u) => {
          const canManage = !u.is_master && (isMaster || (u.role !== 'super_admin' && u.role !== 'pro_admin'));
          if (editingUserId === u.id) {
            return (
              <form key={u.id} className="panel form-grid" onSubmit={handleSaveUserEdit}>
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
            <div key={u.id} className="user-row panel">
              <div className={`avatar avatar-${u.role}`} aria-hidden="true">
                {initials(u)}
              </div>
              <div className="user-main">
                <div className="title">
                  {formatUserName(u)} {!!u.is_master && <span className="key-tag">MASTER</span>}
                </div>
                <div className="muted user-email">{u.email}</div>
              </div>
              <div className="user-role">
                <span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role]}</span>
              </div>
              <div className="user-scope muted">
                {u.company ? (
                  <>
                    {u.company} <span className="key-tag">Co.{u.company_id}</span>
                    {u.department && (
                      <>
                        <br />
                        {u.department} <span className="key-tag">Dept.{u.department_id}</span>
                      </>
                    )}
                  </>
                ) : (
                  'All companies'
                )}
              </div>
              {isMaster && (
                <div className="user-insights">
                  {u.is_master ? (
                    <span className="muted">Always on</span>
                  ) : (
                    <label className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={!!u.can_view_insights}
                        onChange={(e) => handleInsightsToggle(u, e.target.checked)}
                      />
                      <span className="switch-track" aria-hidden="true" />
                      <span>Show Insights</span>
                    </label>
                  )}
                </div>
              )}
              <div className="user-actions row">
                {canManage && (
                  <>
                    <button onClick={() => startEditUser(u)}>Edit</button>
                    <button className="danger" onClick={() => handleDelete(u)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
              {rowError[u.id] && <p className="error user-row-error">{rowError[u.id]}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
