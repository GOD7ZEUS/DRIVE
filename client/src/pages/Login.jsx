import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { needsSetup, login, setup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (needsSetup && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      if (needsSetup) {
        await setup(email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="panel form-grid login-form" onSubmit={handleSubmit}>
        <h1>Drive</h1>
        {needsSetup ? (
          <p className="muted">Welcome — create the Super Admin account to get started.</p>
        ) : (
          <p className="muted">Sign in to continue</p>
        )}
        <label>
          Email
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={needsSetup ? 6 : undefined}
          />
        </label>
        {needsSetup && (
          <label>
            Confirm password
            <br />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Please wait…' : needsSetup ? 'Create Super Admin' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
