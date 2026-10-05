import 'dotenv/config';
import { mockResponse } from './mock.js';

// "fast" tier = cheaper model for the rewrite + fact-check; it also has its own per-minute token bucket on Groq.
export const FAST_MODEL = () => process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b';
export const MODEL = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
export const hasKey = () => process.env.LLM_MOCK === '1' || Boolean(process.env.GROQ_API_KEY);

// Thrown immediately (no retry loop) when a model's DAILY token allowance is gone — waiting would take minutes to hours.
export class QuotaError extends Error {
  constructor(message, retryAfter) { super(message); this.code = 'QUOTA'; this.retryAfter = retryAfter; }
}

// Groq's free tier caps tokens/minute per model. Rather than burning retries on 429s, wait for headroom.
const TPM = +process.env.GROQ_TPM || 7600; // Groq's free tier allows 8,000 tokens/minute per model; keep a small margin
const windows = new Map(); // model -> [{t, n}]
const blockedUntil = new Map(); // model -> epoch ms until which its daily quota is known to be exhausted
const MAX_BLOCK_MS = 15 * 60 * 1000; // re-probe at least this often
async function throttle(model, estimate) {
  const w = windows.get(model) || windows.set(model, []).get(model);
  for (;;) {
    const now = Date.now();
    while (w.length && now - w[0].t > 60000) w.shift();
    const used = w.reduce((a, b) => a + b.n, 0);
    if (used + estimate <= TPM || !w.length) break;
    await new Promise((r) => setTimeout(r, Math.min(5000, 60000 - (now - w[0].t) + 50)));
  }
  const rec = { t: Date.now(), n: estimate }; w.push(rec); return rec;
}

async function groqJSON({ system, user, schema, max_tokens, temperature, meter, tier, name }) {
  const model = tier === 'fast' ? FAST_MODEL() : MODEL();
  const blocked = blockedUntil.get(model);
  if (blocked && blocked > Date.now()) throw new QuotaError(`Daily token limit reached for ${model}`, Math.ceil((blocked - Date.now()) / 1000));
  const sys = `${system}\n\nRespond with ONLY a single JSON object that conforms to this JSON Schema (no prose, no markdown):\n${JSON.stringify(schema)}`;
  let last = '';
  let want = max_tokens; // grown only if a response is cut off (finish=length)
  for (let attempt = 0; attempt < 6; attempt++) {
    // Groq counts prompt + requested max_tokens against tokens/minute up front, so don't over-ask
    const estimate = Math.ceil((sys.length + user.length) / 3.8) + want; // ~4 characters per token for English prose
    const tw = Date.now();
    const rec = await throttle(model, estimate);
    const waited = Date.now() - tw;
    const ta = Date.now();
    if (process.env.LLM_TIMING === '1') console.log(`[llm]   sending ${name} to ${model}: system ${sys.length} chars, user ${user.length} chars, est ${estimate}, throttle wait ${waited}ms`);
    let r;
    try {
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      signal: AbortSignal.timeout(60000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model, temperature, max_tokens: want, reasoning_effort: "low",
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    });
    } catch (e) { rec.n = 0; last = `${e.name}${e.cause?.code ? ':' + e.cause.code : ''}`; await new Promise((s) => setTimeout(s, Math.min(8000, 700 * 2 ** attempt))); if (process.env.LLM_TIMING === '1') console.log(`[llm]   attempt ${attempt + 1} ${model} FAILED ${e.name} after ${Date.now() - ta}ms (throttle wait ${waited}ms)`); continue; } // timeout / network: retry
    if (r.status === 429 || r.status >= 500) {
      rec.n = 0;
      last = `HTTP ${r.status}`;
      if (r.status === 429) {
        const body = await r.clone().text();
        if (/per day|TPD/i.test(body)) {
          rec.n = 0; // a rejected request must not keep its tokens reserved
          const ra = +r.headers.get('retry-after') || 0;
          blockedUntil.set(model, Date.now() + Math.min(ra * 1000 || MAX_BLOCK_MS, MAX_BLOCK_MS));
        }
        if (/per day|TPD/i.test(body)) throw new QuotaError(`Daily token limit reached for ${model}`, +r.headers.get('retry-after') || 0);
      }
      if (process.env.LLM_TIMING === '1') console.log(`[llm]   attempt ${attempt + 1} ${model} HTTP ${r.status}: ${(await r.clone().text()).slice(0, 300)} | retry-after=${r.headers.get('retry-after')}`);
      const wait = Math.min(30, +r.headers.get('retry-after') || 2 * (attempt + 1));
      await new Promise((s) => setTimeout(s, wait * 1000)); continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 400 && j.error?.code === 'json_validate_failed') { rec.n = 0; last = 'json_validate_failed'; continue; }
      throw new Error(j.error?.message || `Groq error ${r.status}`);
    }
    const ch = j.choices?.[0]; last = `finish=${ch?.finish_reason}`;
    if (process.env.LLM_TIMING === '1') console.log(`[llm]   attempt ${attempt + 1} ${model} ${Date.now() - ta}ms (throttle wait ${waited}ms, est ${estimate}) tokens in/out ${j.usage?.prompt_tokens}/${j.usage?.completion_tokens} finish=${ch?.finish_reason}`);
    if (j.usage?.total_tokens) rec.n = j.usage.total_tokens; // replace estimate with the real figure
    meter?.usage(j.usage?.prompt_tokens, j.usage?.completion_tokens);
    if (ch?.finish_reason === 'length') want = Math.min(Math.round(want * 1.6), 6000); // truncated: allow more room next time
    try { return JSON.parse(ch.message.content); } catch { /* retry on malformed JSON */ }
  }
  throw new Error(`Model did not return valid JSON (${last})`);
}

// Collects per-request performance data: wall time, number of model calls, token usage.
export function createMeter() {
  const m = { calls: 0, ms: 0, promptTokens: 0, completionTokens: 0, model: MODEL() };
  m.usage = (p = 0, c = 0) => { m.promptTokens += p; m.completionTokens += c; };
  m.summary = () => ({ model: m.model, calls: m.calls, latencyMs: Math.round(m.ms), promptTokens: m.promptTokens, completionTokens: m.completionTokens, fallback: Boolean(m.fallback), totalTokens: m.promptTokens + m.completionTokens });
  return m;
}

export async function callJSON({ system, user, schema, name = 'respond', max_tokens = 2000, temperature = 0.2, meter, tier }) {
  const args = { system, user, schema, name, max_tokens, temperature, meter, tier };
  const t0 = Date.now();
  if (process.env.LLM_MOCK === '1') { if (meter) { meter.calls++; } return mockResponse(name, user); }
  try {
    try { return await groqJSON(args); }
    catch (e) {
      // main model out of daily tokens -> degrade to the smaller model immediately rather than failing or stalling
      if (e.code === 'QUOTA' && tier !== 'fast' && FAST_MODEL() !== MODEL()) {
        if (meter) meter.fallback = true;
        return await groqJSON({ ...args, tier: 'fast' });
      }
      throw e;
    }
  }
  finally {
    const ms = Date.now() - t0;
    if (meter) { meter.calls++; meter.ms += ms; (meter.log ||= []).push({ name, tier: tier || 'main', ms }); }
    if (process.env.LLM_TIMING === '1') console.log(`[llm] ${name} (${tier || 'main'}) ${ms}ms`);
  }
}
