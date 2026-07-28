export default function AccountDrawer({ user, theme, toggleTheme, onClose, onOpenChangePassword, onLogout }) {
  const roleLabel = user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'View';

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel panel" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <span className="brand">Drive</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="drawer-account">
          <div className="title">
            {user.email} {user.is_master && <span className="key-tag">MASTER</span>}
          </div>
          <div className="muted">{roleLabel}</div>
        </div>

        <div className="drawer-actions">
          <button onClick={toggleTheme}>{theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
          <button onClick={onOpenChangePassword}>Change Password</button>
          <button className="danger" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
