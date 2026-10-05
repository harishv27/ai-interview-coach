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

test('resume upload extracts text from a PDF and gives a clear error for a broken one', async () => {
  const { readFile } = await import('node:fs/promises');
  const good = new FormData(); good.append('resume', new Blob([await readFile(new URL('./fixtures/resume.pdf', import.meta.url))], { type: 'application/pdf' }), 'resume.pdf');
  const r = await fetch(base + '/api/resume', { method: 'POST', body: good });
  assert.equal(r.status, 200); assert.match((await r.json()).text, /Product Manager/);
  const bad = new FormData(); bad.append('resume', new Blob(['%PDF-1.4 not really a pdf'], { type: 'application/pdf' }), 'bad.pdf');
  const rb = await fetch(base + '/api/resume', { method: 'POST', body: bad });
  assert.equal(rb.status, 422); assert.match((await rb.json()).error, /Could not read this PDF/);
});

test('voice: status, transcription, speech and interviewer turn work end to end (mock model)', async () => {
  const h = { 'x-forwarded-for': '10.0.0.20' };
  const st = await (await fetch(base + '/api/voice/status')).json();
  assert.equal(st.stt, true); assert.ok(['orpheus', 'browser'].includes(st.tts));

  // too-short audio is treated as silence, real-sized audio is transcribed
  const tiny = new FormData(); tiny.append('audio', new Blob([new Uint8Array(100)], { type: 'audio/webm' }), 'a.webm');
  assert.equal((await (await fetch(base + '/api/voice/transcribe', { method: 'POST', body: tiny, headers: h })).json()).text, '');
  const real = new FormData(); real.append('audio', new Blob([new Uint8Array(4000)], { type: 'audio/webm;codecs=opus' }), 'a.webm'); real.append('prompt', 'Redis, FastAPI');
  const tr = await fetch(base + '/api/voice/transcribe', { method: 'POST', body: real, headers: h });
  assert.equal(tr.status, 200); assert.match((await tr.json()).text, /mock transcript/);
  assert.equal((await fetch(base + '/api/voice/transcribe', { method: 'POST', headers: h })).status, 400);

  const sp = await post('/api/voice/speak', { text: 'Hello there.' }, h);
  assert.equal(sp.status, 200); assert.equal(sp.headers.get('content-type'), 'audio/wav');
  assert.equal((await sp.arrayBuffer()).byteLength > 44, true);
  assert.equal((await post('/api/voice/speak', { text: 'x'.repeat(401) }, h)).status, 400);

  const t1 = await (await post('/api/voice/turn', { ...ctx, question: 'Q?', answer: 'I cached things.', followUpsUsed: 0 }, h)).json();
  assert.ok(t1.ack && t1.follow_up && t1.move_on === false);
  const t2 = await (await post('/api/voice/turn', { ...ctx, question: 'Q?', answer: 'I cached things.', followUpsUsed: 1 }, h)).json();
  assert.equal(t2.follow_up, ''); assert.equal(t2.move_on, true, 'no follow-ups left -> must move on');
  assert.equal((await post('/api/voice/turn', { role: 'PM', question: 'Q?' }, h)).status, 400);
});
