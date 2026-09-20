import { Router } from 'express';
import { all } from '../db.js';

const router = Router();

// Who deleted or edited what, across the whole app — master account only.
router.get('/', async (req, res, next) => {
  try {
    if (!req.user.is_master) {
      return res.status(403).json({ error: 'only the master account can view the activity log' });
    }
    const entries = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500');
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

export default router;
