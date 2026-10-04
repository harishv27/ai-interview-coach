import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const useGroq = () => Boolean(process.env.GROQ_API_KEY);
export const MODEL = () => (useGroq() ? process.env.GROQ_MODEL || 'openai/gpt-oss-120b' : process.env.COACH_MODEL || 'claude-sonnet-5-5');
export const hasKey = () => useGroq() || Boolean(process.env.ANTHROPIC_API_KEY);

let anthropic;

async function groqJSON({ system, user, schema, max_tokens, temperature }) {
  const sys = `${system}\n\nRespond with ONLY a single JSON object that conforms to this JSON Schema (no prose, no markdown):\n${JSON.stringify(schema)}`;
  let last = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    let r;
    try {
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      signal: AbortSignal.timeout(60000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: MODEL(), temperature, max_tokens: max_tokens + 2000, reasoning_effort: "low",
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
    try { return JSON.parse(ch.message.content); } catch { /* retry on malformed JSON */ }
  }
  throw new Error(`Model did not return valid JSON (${last})`);
}

async function anthropicJSON({ system, user, schema, name, max_tokens, temperature }) {
  anthropic ??= new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL(), max_tokens, temperature, system,
    tools: [{ name, description: 'Return the structured result.', input_schema: schema }],
    tool_choice: { type: 'tool', name },
    messages: [{ role: 'user', content: user }],
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('Model returned no structured output');
  return block.input;
}

export function callJSON({ system, user, schema, name = 'respond', max_tokens = 2000, temperature = 0.2 }) {
  const args = { system, user, schema, name, max_tokens, temperature };
  return useGroq() ? groqJSON(args) : anthropicJSON(args);
}
