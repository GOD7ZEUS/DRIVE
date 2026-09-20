import { Router } from 'express';
import { all } from '../db.js';
import { pruneAuditLog } from '../auditRetention.js';

const router = Router();

// Who deleted or edited what, across the whole app — master account only.
// Entries older than 30 days are pruned on a schedule (see auditRetention.js)
// and, as a cheap belt-and-suspenders check, right before every read too —
// so what's shown here is never stale even between scheduled sweeps.
router.get('/', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can view the activity log' });
    }
    await pruneAuditLog();
    const entries = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500');
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

export default router;
