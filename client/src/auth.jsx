import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then(setUser)
      .catch(async () => {
        // Any failure here (not authenticated, or a transient platform-level error
        // like a cold-start 404 on a free hosting tier) means we don't know who's
        // logged in — always check setup status rather than silently assuming
        // "no setup needed" just because the error wasn't a clean 401.
        setUser(null);
        const status = await api.getAuthStatus().catch(() => ({ needsSetup: false }));
        setNeedsSetup(status.needsSetup);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const loggedInUser = await api.login(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function setup(email, password) {
    const newUser = await api.setup(email, password);
    setNeedsSetup(false);
    setUser(newUser);
    return newUser;
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, needsSetup, loading, login, setup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
