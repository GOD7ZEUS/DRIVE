import { useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useTheme } from './theme.js';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Users from './pages/Users.jsx';
import Companies from './pages/Companies.jsx';
import Login from './pages/Login.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';

export default function App() {
  const { user, loading, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const [showChangePassword, setShowChangePassword] = useState(false);

  if (loading) return <LoadingScreen />;
  if (!user) return <Login />;

  return (
    <div className="app">
      <nav className="navbar">
        <span className="brand">Drive</span>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Dashboard
        </NavLink>
        {user.role === 'super_admin' && (
          <NavLink to="/companies" className={({ isActive }) => (isActive ? 'active' : '')}>
            Companies
          </NavLink>
        )}
        <NavLink to="/projects" className={({ isActive }) => (isActive ? 'active' : '')}>
          Projects
        </NavLink>
        {user.role === 'super_admin' && (
          <NavLink to="/users" className={({ isActive }) => (isActive ? 'active' : '')}>
            Users
          </NavLink>
        )}
        <div className="navbar-right">
          <button onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <span className="muted">
            {user.email} · {user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'View'}
          </span>
          <button onClick={() => setShowChangePassword(true)}>Change Password</button>
          <button onClick={logout}>Log out</button>
        </div>
      </nav>
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      <main className="content" key={location.pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {user.role === 'super_admin' && <Route path="/companies" element={<Companies />} />}
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          {user.role === 'super_admin' && <Route path="/users" element={<Users />} />}
        </Routes>
      </main>
    </div>
  );
}
