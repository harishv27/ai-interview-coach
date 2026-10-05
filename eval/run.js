// Usage: npm run eval            (all cases, 1 run each)
//        node eval/run.js --runs 3 --only cal   (repeatability on calibration set)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAnswer } from '../lib/coach.js';
import { hasKey, MODEL } from '../lib/llm.js';
import { CRITERIA_KEYS } from '../lib/rubric.js';
import { inventedNumbers } from '../lib/guards.js';
import { ROLE, RESUME, JD, SET } from './fixtures.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const RUNS = +arg('runs', 1), ONLY = arg('only', '');
if (!hasKey()) { console.error('Set GROQ_API_KEY first (see .env.example).'); process.exit(1); }

const IDS = arg('ids', '').split(',').filter(Boolean);
const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8')).filter((c) => (IDS.length ? IDS.includes(c.id) : c.id.startsWith(ONLY)));
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const humanOverall = (h) => mean(CRITERIA_KEYS.map((k) => h[k]));

async function runCase(c) {
  const runs = [];
  let error;
  for (let i = 0; i < RUNS; i++) { try { runs.push(await evaluateAnswer({ resume: RESUME, jd: JD, role: ROLE, question: c.question, answer: c.answer })); } catch (e) { error = e.message; } }
  return { c, runs, error };
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const all_ = await pool(cases, 1, runCase);
const errored = all_.filter((r) => !r.runs.length);
const results = all_.filter((r) => r.runs.length);
const summary = {};
const lines = [`# Eval report`, ``, `- Set: \`${SET}\`  · Model: \`${MODEL()}\`  · Runs/case: ${RUNS}  · Date: ${new Date().toISOString()}`, ``];

if (errored.length) lines.push(`## 0. Cases that errored (no usable output)`, ``, ...errored.map((r) => `- ${r.c.id}: ${r.error}`), ``);
// ---- Calibration vs human labels
const cal = results.filter((r) => r.c.human && !r.c.held_out);
const held = results.filter((r) => r.c.human && r.c.held_out);
if (cal.length) {
  const err = Object.fromEntries(CRITERIA_KEYS.map((k) => [k, []]));
  const ov = [];
  lines.push(`## 1. Calibration vs human labels (${cal.length} cases)`, ``, `| Case | Human overall | AI overall | Δ | per-criterion Δ (rel/str/spe/imp/cla) | σ across runs |`, `|---|---|---|---|---|---|`);
  for (const { c, runs } of cal) {
    const ai = Object.fromEntries(CRITERIA_KEYS.map((k) => [k, mean(runs.map((r) => r.evaluation.scores[k]))]));
    const per = CRITERIA_KEYS.map((k) => { const d = ai[k] - c.human[k]; err[k].push(d); return (d >= 0 ? '+' : '') + d.toFixed(1); });
    const aiO = mean(runs.map((r) => r.evaluation.overall)), hO = humanOverall(c.human);
    ov.push({ a: aiO, h: hO });
    lines.push(`| ${c.id} | ${hO.toFixed(1)} | ${aiO.toFixed(1)} | ${(aiO - hO >= 0 ? '+' : '') + (aiO - hO).toFixed(1)} | ${per.join(' / ')} | ${sd(runs.map((r) => r.evaluation.overall)).toFixed(2)} |`);
  }
  const all = Object.values(err).flat();
  summary.mae = mean(all.map(Math.abs)); summary.bias = mean(all); summary.within1 = all.filter((d) => Math.abs(d) <= 1).length / all.length;
  lines.push(``, `**MAE:** ${mean(all.map(Math.abs)).toFixed(2)} · **Bias (+ = AI too generous):** ${mean(all).toFixed(2)} · **Within ±1 of human:** ${(100 * all.filter((d) => Math.abs(d) <= 1).length / all.length).toFixed(0)}%`);
  lines.push(``, `Per-criterion MAE: ${CRITERIA_KEYS.map((k) => `${k} ${mean(err[k].map(Math.abs)).toFixed(2)}`).join(' · ')}`, ``);
  // pairwise ranking agreement
  let agree = 0, tot = 0;
  for (let i = 0; i < ov.length; i++) for (let j = i + 1; j < ov.length; j++) if (Math.abs(ov[i].h - ov[j].h) >= 0.6) { tot++; if ((ov[i].a - ov[j].a) * (ov[i].h - ov[j].h) > 0) agree++; }
  summary.rank = [agree, tot];
  lines.push(`**Ranking agreement** (pairs the humans separated by ≥0.6): ${agree}/${tot}`, ``);
}

// ---- Held-out cases: written and labelled before any rule was tuned on the dev set
if (held.length) {
  const err = [];
  lines.push(`## 1b. Held-out calibration (${held.length} cases, never used for tuning)`, ``, `| Case | Human | AI | Δ | per-criterion Δ |`, `|---|---|---|---|---|`);
  for (const { c, runs } of held) {
    const ai = Object.fromEntries(CRITERIA_KEYS.map((k) => [k, mean(runs.map((r) => r.evaluation.scores[k]))]));
    const per = CRITERIA_KEYS.map((k) => { const d = ai[k] - c.human[k]; err.push(d); return (d >= 0 ? '+' : '') + d.toFixed(1); });
    const aiO = mean(runs.map((r) => r.evaluation.overall)), hO = humanOverall(c.human);
    lines.push(`| ${c.id} | ${hO.toFixed(1)} | ${aiO.toFixed(1)} | ${(aiO - hO >= 0 ? '+' : '') + (aiO - hO).toFixed(1)} | ${per.join(' / ')} |`);
  }
  summary.held = { n: held.length, mae: mean(err.map(Math.abs)), bias: mean(err), within1: err.filter((d) => Math.abs(d) <= 1).length / err.length };
  lines.push(``, `**Held-out MAE:** ${summary.held.mae.toFixed(2)} · **Bias:** ${summary.held.bias.toFixed(2)} · **Within ±1:** ${Math.round(summary.held.within1 * 100)}%`, ``);
}

// ---- Adversarial expectations
const adv = results.filter((r) => r.c.expect);
let pass = 0;
if (adv.length) {
  lines.push(`## 2. Failure-mode tests (${adv.length} cases)`, ``, `| Case | Failure mode probed | Result | Details |`, `|---|---|---|---|`);
  for (const { c, runs } of adv) {
    const e = c.expect, fails = [];
    for (const { evaluation: ev, flags } of runs) {
      if (e.maxOverall != null && ev.overall > e.maxOverall) fails.push(`overall ${ev.overall} > ${e.maxOverall}`);
      if (e.minOverall != null && ev.overall < e.minOverall) fails.push(`overall ${ev.overall} < ${e.minOverall}`);
      for (const [k, m] of Object.entries(e.maxCriteria || {})) if (ev.scores[k] > m) fails.push(`${k} ${ev.scores[k]} > ${m}`);
      if (e.flagsTechnicalOrLowConfidence && !(ev.technical_claims_to_verify.length || ev.confidence !== 'high')) fails.push('confident, no claim flagged');
      for (const q of e.noStrengthQuotes || []) if (ev.strengths.some((s) => s.quote.toLowerCase().includes(q.toLowerCase()))) fails.push(`praised: "${q}"`);
      if (e.flagType && !flags.some((f) => f.type === e.flagType)) fails.push(`missing flag ${e.flagType}`);
      if (e.nonAnswer && !(ev.non_answer && ev.improved_kind === 'outline' && ev.gaps.length <= 1 && ev.strengths.length === 0)) fails.push('non-answer not handled (outline / single gap / no strengths)');
      if (e.nonAnswer && ev.follow_up && /^(can you|could you) (describe|tell)/i.test(ev.follow_up) && ev.follow_up.length > 150) fails.push('follow-up repeats the question');
      if (e.noInventedNumbers && inventedNumbers(ev.improved_answer, c.answer, RESUME).length) fails.push('invented numbers in rewrite');
    }
    const ok = !fails.length; if (ok) pass++;
    lines.push(`| ${c.id} | ${c.failure_mode} | ${ok ? '✅ pass' : '❌ FAIL'} | ${ok ? 'overall ' + mean(runs.map((r) => r.evaluation.overall)).toFixed(1) : [...new Set(fails)].join('; ')} |`);
  }
  summary.adv = [pass, adv.length];
  lines.push(``, `**Failure-mode pass rate:** ${pass}/${adv.length}`, ``);
}

// ---- Guardrail activity
const flagCounts = {};
results.forEach((r) => r.runs.forEach((x) => x.flags.forEach((f) => (flagCounts[f.type] = (flagCounts[f.type] || 0) + 1))));
lines.push(`## 3. Guardrail activity`, ``, Object.keys(flagCounts).length ? Object.entries(flagCounts).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n') : '- none triggered', ``);

// ---- Performance (latency + tokens per evaluated answer; one "answer" = evaluate + rewrite audit)
const metas = results.flatMap((r) => r.runs.map((x) => x.meta)).filter(Boolean);
const pct = (a, q) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : null; };
if (metas.length) {
  summary.latencyP50 = pct(metas.map((m) => m.latencyMs), 0.5); summary.latencyP95 = pct(metas.map((m) => m.latencyMs), 0.95);
  summary.avgTokens = Math.round(mean(metas.map((m) => m.totalTokens))); summary.avgCalls = +mean(metas.map((m) => m.calls)).toFixed(1);
  lines.push(`## 4. Performance`, ``, `- Latency per answer: p50 **${(summary.latencyP50 / 1000).toFixed(1)}s**, p95 **${(summary.latencyP95 / 1000).toFixed(1)}s** (n=${metas.length})`, `- Tokens per answer: **${summary.avgTokens}** (${Math.round(mean(metas.map((m) => m.promptTokens)))} in / ${Math.round(mean(metas.map((m) => m.completionTokens)))} out) over ${summary.avgCalls} model calls`, ``);
}
summary.errors = errored.length;
summary.fallbackRate = metas.length ? metas.filter((m) => m.fallback).length / metas.length : null;
if (summary.fallbackRate) lines.push(`> ⚠️ ${Math.round(summary.fallbackRate * 100)}% of answers were scored by the smaller backup model because the main model's daily free quota was exhausted; results are less reliable than a full-quota run.`, ``);
// Quality gate (use --gate in CI): fail the run if quality regresses below targets.
const gateReasons = [];
if (summary.adv && summary.adv[0] / summary.adv[1] < 0.85) gateReasons.push(`failure-mode pass rate ${summary.adv.join('/')} < 85%`);
if (summary.mae != null && summary.mae > 0.8) gateReasons.push(`MAE ${summary.mae.toFixed(2)} > 0.80`);
if (summary.within1 != null && summary.within1 < 0.85) gateReasons.push(`within-±1 ${Math.round(summary.within1 * 100)}% < 85%`);
if (summary.errors) gateReasons.push(`${summary.errors} case(s) errored`);
summary.gate = gateReasons.length ? 'fail' : 'pass';
lines.push(`## 5. Quality gate: ${gateReasons.length ? '❌ FAIL' : '✅ pass'}`, ``, ...(gateReasons.length ? gateReasons.map((r) => `- ${r}`) : ['- all thresholds met (bias is reported but not gating)']), ``);
summary.flags = flagCounts;
const report = lines.join('\n');
fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(dir, 'results', `${stamp}.md`), report);
fs.writeFileSync(path.join(dir, 'results', `${stamp}.raw.json`), JSON.stringify(results, null, 2));
// ---- Append to the run history (read by scripts/report.js -> docs/PERFORMANCE.md)
if (!ONLY && !IDS.length || process.argv.includes('--record')) fs.appendFileSync(path.join(dir, 'results', 'history.jsonl'), JSON.stringify({ date: new Date().toISOString(), set: SET, model: MODEL(), runsPerCase: RUNS, cases: cases.length, source: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local', ...summary }) + '\n');
console.log(report);
if (process.argv.includes('--gate') && gateReasons.length) { console.error('GATE FAILED: ' + gateReasons.join('; ')); process.exit(1); }
