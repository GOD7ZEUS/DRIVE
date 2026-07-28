import { useState } from 'react';
import { api } from '../api.js';

const SUGGESTIONS = [
  'What was the name of your first pet?',
  'What city were you born in?',
  "What is your mother's maiden name?",
  'What was the make of your first vehicle?',
  'What was the name of your first school?',
];

export default function SecurityQuestionModal({ dismissible = true, onClose, onSaved }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.setSecurityQuestion(question, answer);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={dismissible ? onClose : undefined}>
      <form className="panel modal-content" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="row-between">
          <h2>Set a Security Question</h2>
          {dismissible && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <p className="muted">
          Used to verify it's really you if you ever need to reset your password without your current one.
        </p>
        <label>
          Question
          <br />
          <input
            list="security-question-suggestions"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            autoFocus
          />
          <datalist id="security-question-suggestions">
            {SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          Answer
          <br />
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
          {dismissible && (
            <button type="button" onClick={onClose}>
              Remind me later
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
