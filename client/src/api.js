// In dev (Vite on :5173), the API lives on a separate port — use whatever host the
// page was loaded from (localhost, 127.0.0.1, or a LAN IP) so a phone on the same
// WiFi can reach it too. In production (built client served by the same Express
// server that hosts the API — Electron, or a tunnel) everything is one origin, so
// a relative path works regardless of hostname/port, which matters for tunnels
// where the public URL doesn't expose the internal port at all.
const BASE_URL = window.location.port === '5173' ? `http://${window.location.hostname}:3001/api` : '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getProjects: () => request('/projects'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  getMilestones: (projectId) => request(`/projects/${projectId}/milestones`),
  createMilestone: (projectId, data) =>
    request(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) }),
  updateMilestone: (id, data) => request(`/milestones/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMilestone: (id) => request(`/milestones/${id}`, { method: 'DELETE' }),

  getProjectTasks: (projectId) => request(`/projects/${projectId}/tasks`),
  createTask: (projectId, data) =>
    request(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  getTask: (id) => request(`/tasks/${id}`),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  getComments: (taskId) => request(`/tasks/${taskId}/comments`),
  createComment: (taskId, data) =>
    request(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify(data) }),

  getDashboard: () => request('/dashboard'),

  getAuthStatus: () => request('/auth/status'),
  setup: (email, password) =>
    request('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  setSecurityQuestion: (question, answer) =>
    request('/auth/security-question', { method: 'POST', body: JSON.stringify({ question, answer }) }),
  getSecurityQuestion: (email) =>
    request('/auth/forgot-password/question', { method: 'POST', body: JSON.stringify({ email }) }),
  verifySecurityAnswer: (email, answer) =>
    request('/auth/forgot-password/verify-answer', { method: 'POST', body: JSON.stringify({ email, answer }) }),
  sendResetOtpDirect: (email) =>
    request('/auth/forgot-password/send-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (email, otp, newPassword) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, otp, newPassword }) }),

  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  getCompanies: () => request('/companies'),
  getCompanyDepartments: (companyId) => request(`/companies/${companyId}/departments`),

  chat: (messages) => request('/chat', { method: 'POST', body: JSON.stringify({ messages }) }),
};
