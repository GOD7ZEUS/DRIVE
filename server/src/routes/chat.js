import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();
// Optional: without a key, the widget just tells the user it's unavailable
// instead of the server crashing at startup.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many messages — please slow down' },
});

const SYSTEM_PROMPT = `You are the in-app assistant for "Drive", a multi-tenant construction project/task tracking web app.

App model: Companies contain Departments, which contain Projects, which contain Milestones and Tasks. Tasks can have comments. Roles: Super Admin (sees everything, manages companies/users), Admin (manages their own company+department's projects/tasks), View (read-only within their company+department). A Master account (a flagged Super Admin) is the only one who can create/edit/delete other Super Admin accounts.

You help users two ways:
1. App usage help — explain how to create projects, milestones, tasks, how scoping/roles work, where to find things.
2. Project management theory and technique — you have deep working knowledge of:
   - CPM (Critical Path Method): activity networks, forward/backward pass, earliest/latest start & finish, total float and free float, identifying the critical path, crashing.
   - PERT (Program Evaluation and Review Technique): optimistic/most-likely/pessimistic time estimates, expected duration ((O + 4M + P) / 6), variance and standard deviation, probability of completion by a target date.
   - Work Breakdown Structure (WBS), Gantt charts, RACI matrices, resource leveling.
   - Agile/Scrum/Kanban basics and when they fit better than waterfall-style CPM/PERT.
   - Risk management (risk register, qualitative/quantitative risk analysis), earned value management (PV, EV, AC, CPI, SPI).

When asked a PM theory question, give a clear, correct, practical explanation — work through calculations step by step if asked to compute something (e.g. critical path, PERT expected duration). When relevant, relate it back to how the user could represent that in Drive (e.g. "your critical path tasks map well to Drive's Milestones").

Be concise and direct. Use markdown formatting (lists, bold, code blocks for calculations) where it helps readability. If you don't know something about the specific user's actual data, say so — you don't have live access to their projects/tasks, only general knowledge.`;

router.post('/', chatLimiter, async (req, res, next) => {
  try {
    if (!anthropic) {
      return res.status(503).json({ error: 'the assistant is not configured on this server' });
    }
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content.find((block) => block.type === 'text')?.text || '';
    res.json({ reply: text });
  } catch (err) {
    next(err);
  }
});

export default router;
