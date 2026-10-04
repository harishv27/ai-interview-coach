// Verifies the quota fallback with a stubbed network: no key, no real calls.
process.env.GROQ_API_KEY = 'test-key';
delete process.env.LLM_MOCK;
import test from 'node:test';
import assert from 'node:assert/strict';
const { callJSON, createMeter, QuotaError } = await import('../lib/llm.js');

const ok = (content) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200 });
const tpd = () => new Response(JSON.stringify({ error: { message: 'Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 199456' } }), { status: 429, headers: { 'retry-after': '802' } });

test('falls back to the smaller model immediately when the main model hits its daily limit', async () => {
  const seen = [];
  globalThis.fetch = async (_url, init) => { const m = JSON.parse(init.body).model; seen.push(m); return m.includes('120b') ? tpd() : ok('{"a":1}'); };
  const meter = createMeter();
  const t0 = Date.now();
  const out = await callJSON({ system: 's', user: 'u', schema: {}, name: 'evaluate', max_tokens: 100, meter });
  assert.deepEqual(out, { a: 1 });
  assert.deepEqual(seen, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  assert.equal(meter.summary().fallback, true);
  assert.ok(Date.now() - t0 < 2000, 'must not sit in a retry loop');
});

test('throws QuotaError (no stalling) when the fallback model is also out of daily tokens', async () => {
  globalThis.fetch = async () => tpd();
  await assert.rejects(() => callJSON({ system: 's', user: 'u', schema: {}, name: 'evaluate', max_tokens: 100 }), (e) => e instanceof QuotaError && e.retryAfter === 802);
});

test('a truncated response is retried with more room', async () => {
  const sizes = [];
  globalThis.fetch = async (_u, init) => { sizes.push(JSON.parse(init.body).max_tokens); return sizes.length === 1 ? new Response(JSON.stringify({ choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }], usage: {} }), { status: 200 }) : ok('{"a":2}'); };
  const out = await callJSON({ system: 's', user: 'u', schema: {}, name: 'x', max_tokens: 1000, tier: 'fast' });
  assert.deepEqual(out, { a: 2 }); assert.ok(sizes[1] > sizes[0]);
});
