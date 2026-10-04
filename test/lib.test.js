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
