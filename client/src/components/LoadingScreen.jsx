import { useEffect, useState } from 'react';

// Fake, time-based progress that eases toward (but never reaches) 92% —
// Render's free tier can take up to ~60s to wake from a cold start, and we
// have no real progress signal from the server during that wait, so this
// gives the user something better than a blank screen without lying about
// being "done" before the actual request resolves.
export default function LoadingScreen() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsedSec = (Date.now() - start) / 1000;
      setPercent(Math.round(92 * (1 - Math.exp(-elapsedSec / 15))));
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="loading-screen">
      <div className="loading-screen-brand">Drive</div>
      <div className="loading-bar-track">
        <div className="loading-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="loading-screen-percent">{percent}%</div>
      <img src="/favicon.svg" alt="" className="loading-screen-icon" />
    </div>
  );
}
