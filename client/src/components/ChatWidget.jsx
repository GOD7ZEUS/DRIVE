import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const GREETING = {
  role: 'assistant',
  content:
    "Hi! I'm your Drive assistant. Ask me how to use the app, or anything about project management — critical path (CPM), PERT estimates, WBS, risk management, whatever you need.",
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setSending(true);
    try {
      const { reply } = await api.chat(nextMessages.filter((m) => m !== GREETING));
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
      >
        {open ? '×' : '💬'}
      </button>

      {open && (
        <div className="chat-panel panel">
          <div className="chat-header">
            <strong>Drive Assistant</strong>
          </div>
          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
                {m.content}
              </div>
            ))}
            {sending && <div className="chat-bubble chat-bubble-assistant muted">Thinking…</div>}
            {error && <p className="error">{error}</p>}
            <div ref={bottomRef} />
          </div>
          <form className="chat-input-row" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something…"
              disabled={sending}
            />
            <button type="submit" className="primary" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
