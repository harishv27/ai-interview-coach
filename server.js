import express from 'express';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasKey, MODEL } from './lib/llm.js';
import { planQuestions, evaluateAnswer, summarizeSession } from './lib/coach.js';
import { CRITERIA } from './lib/rubric.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const log = (file, obj) =>
  fs.appendFile(path.join(__dirname, 'data', file), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', () => {});

const wrap = (fn) => async (req, res) => {
  try {
    if (!hasKey()) return res.status(500).json({ error: 'No API key set. Copy .env.example to .env and add GROQ_API_KEY.' });
    res.json(await fn(req));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Something went wrong' });
  }
};

app.get('/api/config', (_req, res) => res.json({ criteria: CRITERIA, model: MODEL(), keyConfigured: hasKey() }));

app.post('/api/resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { originalname, mimetype, buffer } = req.file;
    let text;
    if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
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
  const { resume, jd, role, count } = body;
  if (!resume || !jd || !role) throw new Error('resume, jd and role are required');
  const questions = await planQuestions({ resume, jd, role, count: Math.min(Math.max(+count || 5, 3), 8) });
  log('sessions.jsonl', { event: 'start', role, questions: questions.length });
  return { questions };
}));

app.post('/api/answer', wrap(async ({ body }) => {
  const { resume, jd, role, question, answer, isFollowUp, sessionId, inputMode } = body;
  if (!answer?.trim()) throw new Error('Empty answer');
  const result = await evaluateAnswer({ resume, jd, role, question, answer, isFollowUp });
  log('turns.jsonl', { sessionId, role, question, answer, isFollowUp, inputMode, ...result });
  return result;
}));

app.post('/api/summary', wrap(async ({ body }) => summarizeSession(body)));

// Candidate rates whether the feedback was accurate / useful. Fuels the real-user research.
app.post('/api/feedback', (req, res) => {
  log('feedback.jsonl', req.body);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI Interview Coach → http://localhost:${port}  (model: ${MODEL()})`));
