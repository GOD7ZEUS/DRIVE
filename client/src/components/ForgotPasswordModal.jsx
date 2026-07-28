import { useState } from 'react';
import { api } from '../api.js';

export default function ForgotPasswordModal({ onClose }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.getSecurityQuestion(email);
      if (!res.question) {
        setError('No recovery info is set up for this account. Contact your Super Admin for help.');
        return;
      }
      setQuestion(res.question);
      setStep('answer');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnswerSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.verifySecurityAnswer(email, answer);
      setStep('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(email, otp, newPassword);
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="panel modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Reset Password</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {step === 'email' && (
          <form className="form-grid" onSubmit={handleEmailSubmit}>
            <p className="muted">Enter your account email to start recovery.</p>
            <label>
              Email
              <br />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'answer' && (
          <form className="form-grid" onSubmit={handleAnswerSubmit}>
            <p className="muted">Answer your security question.</p>
            <label>
              {question}
              <br />
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} required autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </button>
              <button type="button" onClick={() => setStep('email')}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 'otp' && (
          <form className="form-grid" onSubmit={handleReset}>
            <p className="muted">Verified — a code was emailed to {email}. Enter it below with a new password.</p>
            <label>
              Reset Code
              <br />
              <input value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus />
            </label>
            <label>
              New Password
              <br />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
            <label>
              Confirm New Password
              <br />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <>
            <p>Password reset. You can now sign in with your new password.</p>
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
