// Rate limiting + daily spend cap. Uses Upstash Redis (REST) when configured — required for limits
// that hold across serverless instances — otherwise falls back to in-memory (per instance, best effort).
const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const persistent = Boolean(URL_ && TOKEN);

const mem = new Map(); // key -> {n, exp}
async function upstash(cmds) {
  const r = await fetch(`${URL_}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(3000) });
  return (await r.json()).map((x) => x.result);
}

/** Increment a counter; returns { ok, count, limit }. Fails OPEN on backend errors (never blocks users on infra faults). */
export async function hit(key, limit, windowSec) {
  try {
    if (persistent) {
      const [count] = await upstash([['INCR', key], ['EXPIRE', key, windowSec, 'NX']]);
      return { ok: count <= limit, count, limit };
    }
    const now = Date.now(); let e = mem.get(key);
    if (!e || e.exp < now) { e = { n: 0, exp: now + windowSec * 1000 }; mem.set(key, e); }
    e.n++;
    if (mem.size > 5000) for (const [k, v] of mem) if (v.exp < now) mem.delete(k);
    return { ok: e.n <= limit, count: e.n, limit };
  } catch { return { ok: true, count: 0, limit }; }
}

export const clientIp = (req) => (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
