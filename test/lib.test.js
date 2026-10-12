import test from 'node:test';
import assert from 'node:assert/strict';
import { redactPII, redactDeep } from '../lib/privacy.js';
import { deliveryMetrics } from '../lib/delivery.js';
import { hit } from '../lib/ratelimit.js';

test('PII redaction removes emails, links and phone numbers but keeps normal numbers', () => {
  const t = redactPII('Mail jane.doe@example.com, +1 (415) 555-0134, https://linkedin.com/in/jane, raised activation 31% to 44% for 3,000 merchants');
  assert.ok(!/jane\.doe|555|linkedin/.test(t)); assert.match(t, /31% to 44% for 3,000 merchants/);
});
test('redactDeep walks nested log objects', () => {
  assert.equal(redactDeep({ a: ['x@y.io'], b: { c: 'ok' } }).a[0], '[email]');
});
test('delivery metrics: fillers, wpm and pace', () => {
  const d = deliveryMetrics('um so we, like, shipped it and basically it worked you know and I really like pizza '.repeat(2), 20, 'voice');
  assert.ok(d.fillers.total >= 6); assert.equal(d.wpm, d.words * 3); assert.ok(['slow', 'good', 'fast'].includes(d.pace));
  assert.equal(deliveryMetrics('short answer here', 5, 'text').wpm, undefined, 'no pace on tiny/short samples');
});
test('in-memory rate limiter counts and blocks past the limit', async () => {
  const k = 'test:' + Math.random();
  const r = []; for (let i = 0; i < 4; i++) r.push((await hit(k, 3, 60)).ok);
  assert.deepEqual(r, [true, true, true, false]);
});

test('redaction and delivery stats stay fast on hostile input (no regex blow-up)', () => {
  const hostile = ['1-'.repeat(50000) + 'x', '.'.repeat(100000), '1 '.repeat(50000) + 'x', 'a'.repeat(100000) + '@', '@' + 'a.'.repeat(50000)];
  for (const h of hostile) {
    const t0 = Date.now(); redactPII(h); deliveryMetrics(h, 20, 'text');
    assert.ok(Date.now() - t0 < 400, `took ${Date.now() - t0}ms on ${h.slice(0, 8)}…`);
  }
});
test('phone redaction still catches real numbers and leaves ordinary numbers alone', () => {
  assert.match(redactPII('call +91 98765 43210 or (415) 555-0134 or 415.555.0134'), /^call \[phone\] or \[phone\] or \[phone\]$/);
  const keep = 'cut latency from 2800ms to 1100ms for 3,000 merchants, a 70% drop in 2021-2023 and 12345';
  assert.equal(redactPII(keep), keep);
});

import { readFileSync } from 'node:fs';
test('interview templates are well-formed and only use options the app supports', () => {
  const { templates } = JSON.parse(readFileSync(new URL('../public/templates.json', import.meta.url), 'utf8'));
  const ids = templates.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  assert.ok(templates.length >= 12);
  for (const t of templates) {
    assert.ok(['Role', 'Round style', 'Skill'].includes(t.group), t.id);
    assert.ok(['mixed', 'behavioural', 'technical', 'system_design'].includes(t.mode), t.id + ' mode');
    assert.ok(['standard', 'tough'].includes(t.level), t.id + ' level');
    assert.ok(t.title && t.role && t.jd.length >= 120 && t.jd.length <= 1200, t.id + ' text');
  }
});
