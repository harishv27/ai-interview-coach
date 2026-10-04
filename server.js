import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasKey, MODEL } from './lib/llm.js';
import { planQuestions, evaluateAnswer, summarizeSession } from './lib/coach.js';
import { CRITERIA } from './lib/rubric.js';
import { redactPII, redactDeep } from './lib/privacy.js';
import { deliveryMetrics } from './lib/delivery.js';
import { hit, clientIp, persistent } from './lib/ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ON_VERCEL = Boolean(process.env.VERCEL);
const LIMITS = { resume: 20000, jd: 12000, answer: 6000, role: 120, question: 600 };
const PER_HOUR = +process.env.RATE_LIMIT_PER_HOUR || 60; // per IP, LLM endpoints
const DAILY_CAP = +process.env.DAILY_CAP || 400; // whole-app daily ceiling on evaluated answers (spend guard)

export const app = express();
app.set('trust proxy', true);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!ON_VERCEL) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
// Structured, PII-redacted log lines. On Vercel they go to runtime logs (read-only filesystem).
const log = (file, obj) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...redactDeep(obj) });
  if (ON_VERCEL) return console.log(`[${file}] ${line}`);
  if (process.env.NODE_ENV !== 'test') fs.appendFile(path.join(__dirname, 'data', file), line + '\n', () => {});
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const need = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };
const tooLong = (name, v, max) => need(typeof v === 'string' && v.length <= max, `${name} is too long (max ${max} characters).`);

// Per-IP hourly limit + global daily cap. Persistent only when Upstash is configured (see README).
async function guard(req, res, cost = 1) {
  const ip = clientIp(req);
  const [perIp, daily] = await Promise.all([hit(`ip:${ip}`, PER_HOUR, 3600), cost ? hit(`day:${new Date().toISOString().slice(0, 10)}`, DAILY_CAP, 86400) : { ok: true }]);
  if (!perIp.ok) { res.set('Retry-After', '3600'); throw new HttpError(429, 'You’ve reached the hourly limit for practice requests. Please try again later.'); }
  if (!daily.ok) { res.set('Retry-After', '3600'); throw new HttpError(429, 'Today’s free capacity has been used up. Please come back tomorrow.'); }
}

const wrap = (fn, { limited = true, cost = 1 } = {}) => async (req, res) => {
  try {
    if (!hasKey()) throw new HttpError(500, 'No API key set. Copy .env.example to .env and add GROQ_API_KEY.');
    if (limited) await guard(req, res, cost);
    res.json(await fn(req));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: status >= 500 && !e.status ? 'Something went wrong on our side. Please try again.' : e.message });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL(), keyConfigured: hasKey(), persistentRateLimit: persistent }));
app.get('/api/config', (_req, res) => res.json({ criteria: CRITERIA, model: MODEL(), keyConfigured: hasKey() }));

app.post('/api/resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, mimetype, buffer } = req.file;
    let text;
    if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
      const { PDFParse } = await import('pdf-parse'); // lazy: pdfjs needs canvas polyfills, don't load at cold start
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      text = (await parser.getText()).text;
      await parser.destroy?.();
    } else {
      text = buffer.toString('utf8');
    }
    text = text.replace(/^-- \d+ of \d+ --$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 50) return res.status(422).json({ error: 'Could not read text from this file (scanned PDF?). Paste your resume text instead.' });
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(422).json({ error: 'Could not parse the file. Try a text-based PDF or .txt.' });
  }
});

app.post('/api/start', wrap(async ({ body }) => {
  const { resume, jd, role, count, mode, difficulty } = body;
  need(resume && jd && role, 'resume, jd and role are required');
  tooLong('Resume', resume, LIMITS.resume); tooLong('Job description', jd, LIMITS.jd); tooLong('Role', role, LIMITS.role);
  const plan = await planQuestions({
    resume: redactPII(resume), jd: redactPII(jd), role,
    count: Math.min(Math.max(+count || 5, 3), 8),
    mode: ['mixed', 'behavioural', 'technical', 'case'].includes(mode) ? mode : 'mixed',
    difficulty: difficulty === 'tough' ? 'tough' : 'standard',
  });
  log('sessions.jsonl', { event: 'start', role, mode, difficulty, questions: plan.questions.length });
  return plan;
}));

app.post('/api/answer', wrap(async ({ body }) => {
  const { resume, jd, role, question, answer, isFollowUp, sessionId, inputMode, seconds, attempt } = body;
  need(answer?.trim(), 'Empty answer'); need(question && role, 'question and role are required');
  tooLong('Answer', answer, LIMITS.answer); tooLong('Resume', resume || '', LIMITS.resume); tooLong('Job description', jd || '', LIMITS.jd); tooLong('Question', question, LIMITS.question);
  const result = await evaluateAnswer({ resume: redactPII(resume || ''), jd: redactPII(jd || ''), role, question, answer: redactPII(answer), isFollowUp: Boolean(isFollowUp) });
  result.delivery = deliveryMetrics(answer, +seconds, inputMode);
  log('turns.jsonl', { sessionId, role, question, answer, isFollowUp, attempt, inputMode, delivery: result.delivery, ...result });
  return result;
}));

app.post('/api/summary', wrap(async ({ body }) => {
  need(Array.isArray(body.turns) && body.turns.length && body.turns.length <= 30, 'turns required');
  return summarizeSession({ role: String(body.role || '').slice(0, LIMITS.role), turns: body.turns });
}, { cost: 0 })); // per-IP limit only; doesn't spend the daily answer budget

// Candidate rates whether the feedback was accurate / useful. Fuels the real-user research.
app.post('/api/feedback', async (req, res) => {
  const { sessionId, question, rating, note } = req.body || {};
  if (!['accurate', 'partly', 'wrong'].includes(rating)) return res.status(400).json({ error: 'invalid rating' });
  try { await guard(req, res, 0); } catch (e) { return res.status(e.status || 429).json({ error: e.message }); }
  log('feedback.jsonl', { sessionId, question: String(question || '').slice(0, 300), rating, note: String(note || '').slice(0, 500) });
  res.json({ ok: true });
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!ON_VERCEL && isMain) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`AI Interview Coach → http://localhost:${port}  (model: ${MODEL()})`));
}
export default app;
