// API tests against the real Express app with the model replaced by lib/mock.js (no network, no key).
process.env.LLM_MOCK = '1';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_PER_HOUR = '6';
process.env.DAILY_CAP = '1000';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
const { app } = await import('../server.js');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const ctx = { resume: 'Priya, PM at Acme. Activation rose 31% to 44%. '.repeat(3), jd: 'Growth PM', role: 'Product Manager' };

test('health reports status', async () => {
  const j = await (await fetch(base + '/api/health')).json();
  assert.equal(j.ok, true); assert.equal(j.keyConfigured, true);
});

test('start returns questions and resume gaps', async () => {
  const r = await post('/api/start', { ...ctx, count: 3 }, { 'x-forwarded-for': '10.0.0.1' });
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.questions.length, 3); assert.ok(Array.isArray(j.gaps));
});

test('start validates required fields and sizes', async () => {
  assert.equal((await post('/api/start', { role: 'PM' }, { 'x-forwarded-for': '10.0.0.2' })).status, 400);
  const r = await post('/api/start', { ...ctx, resume: 'x'.repeat(20001) }, { 'x-forwarded-for': '10.0.0.2' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /too long/);
});

test('answer: guardrails run — unverifiable quotes dropped, verified kept, delivery metrics returned', async () => {
  const answer = 'um so I looked at the funnel and, like, moved the step later and activation rose to 44 percent';
  const r = await post('/api/answer', { ...ctx, question: 'Q?', answer, seconds: 30, inputMode: 'voice' }, { 'x-forwarded-for': '10.0.0.3' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.evaluation.strengths.length, 1, 'verbatim quote kept');
  assert.equal(j.evaluation.gaps.length, 0, 'fabricated quote dropped');
  assert.ok(j.flags.some((f) => f.type === 'dropped_unverified_quote'));
  assert.equal(j.delivery.wpm, 38); assert.ok(j.delivery.fillers.total >= 2);
  assert.ok(j.evaluation.overall > 0);
});

test('answer rejects empty input', async () => {
  assert.equal((await post('/api/answer', { ...ctx, question: 'Q?', answer: '  ' }, { 'x-forwarded-for': '10.0.0.4' })).status, 400);
});

test('feedback validates rating', async () => {
  assert.equal((await post('/api/feedback', { rating: 'meh' }, { 'x-forwarded-for': '10.0.0.5' })).status, 400);
  assert.equal((await post('/api/feedback', { rating: 'accurate', sessionId: 's' }, { 'x-forwarded-for': '10.0.0.5' })).status, 200);
});

test('per-IP rate limit returns 429 with Retry-After', async () => {
  const h = { 'x-forwarded-for': '10.9.9.9' };
  let last;
  for (let i = 0; i < 7; i++) last = await post('/api/start', { ...ctx, count: 3 }, h);
  assert.equal(last.status, 429); assert.ok(last.headers.get('retry-after'));
  assert.match((await last.json()).error, /limit/i);
});

test('resume upload parses text files and rejects empty', async () => {
  const fd = new FormData(); fd.append('resume', new Blob(['Jane Doe\n' + 'Product manager with experience shipping software. '.repeat(3)], { type: 'text/plain' }), 'r.txt');
  const r = await fetch(base + '/api/resume', { method: 'POST', body: fd });
  assert.equal(r.status, 200); assert.match((await r.json()).text, /Jane Doe/);
  assert.equal((await fetch(base + '/api/resume', { method: 'POST' })).status, 400);
});
