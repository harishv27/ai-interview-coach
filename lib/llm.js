import 'dotenv/config';
import { mockResponse } from './mock.js';

// "fast" tier = cheaper model for the rewrite + fact-check; it also has its own per-minute token bucket on Groq.
export const FAST_MODEL = () => process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b';
export const MODEL = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
export const hasKey = () => process.env.LLM_MOCK === '1' || Boolean(process.env.GROQ_API_KEY);

// Groq's free tier caps tokens/minute per model. Rather than burning retries on 429s, wait for headroom.
const TPM = +process.env.GROQ_TPM || 7000;
const windows = new Map(); // model -> [{t, n}]
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

async function groqJSON({ system, user, schema, max_tokens, temperature, meter, tier }) {
  const model = tier === 'fast' ? FAST_MODEL() : MODEL();
  const sys = `${system}\n\nRespond with ONLY a single JSON object that conforms to this JSON Schema (no prose, no markdown):\n${JSON.stringify(schema)}`;
  let last = '';
  const estimate = Math.ceil((sys.length + user.length) / 3.2) + Math.round(max_tokens * 0.6);
  for (let attempt = 0; attempt < 6; attempt++) {
    const rec = await throttle(model, estimate);
    let r;
    try {
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      signal: AbortSignal.timeout(60000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model, temperature, max_tokens: max_tokens + 2000, reasoning_effort: "low",
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    });
    } catch (e) { last = e.name; continue; } // timeout / network: retry
    if (r.status === 429 || r.status >= 500) {
      last = `HTTP ${r.status}`;
      const wait = Math.min(30, +r.headers.get('retry-after') || 2 * (attempt + 1));
      await new Promise((s) => setTimeout(s, wait * 1000)); continue;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `Groq error ${r.status}`);
    const ch = j.choices?.[0]; last = `finish=${ch?.finish_reason}`;
    if (j.usage?.total_tokens) rec.n = j.usage.total_tokens; // replace estimate with the real figure
    meter?.usage(j.usage?.prompt_tokens, j.usage?.completion_tokens);
    try { return JSON.parse(ch.message.content); } catch { /* retry on malformed JSON */ }
  }
  throw new Error(`Model did not return valid JSON (${last})`);
}

// Collects per-request performance data: wall time, number of model calls, token usage.
export function createMeter() {
  const m = { calls: 0, ms: 0, promptTokens: 0, completionTokens: 0, model: MODEL() };
  m.usage = (p = 0, c = 0) => { m.promptTokens += p; m.completionTokens += c; };
  m.summary = () => ({ model: m.model, calls: m.calls, latencyMs: Math.round(m.ms), promptTokens: m.promptTokens, completionTokens: m.completionTokens, totalTokens: m.promptTokens + m.completionTokens });
  return m;
}

export async function callJSON({ system, user, schema, name = 'respond', max_tokens = 2000, temperature = 0.2, meter, tier }) {
  const args = { system, user, schema, name, max_tokens, temperature, meter, tier };
  const t0 = Date.now();
  if (process.env.LLM_MOCK === '1') { if (meter) { meter.calls++; } return mockResponse(name, user); }
  try { return await groqJSON(args); }
  finally { if (meter) { meter.calls++; meter.ms += Date.now() - t0; } }
}
