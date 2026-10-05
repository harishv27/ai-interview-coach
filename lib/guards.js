// Deterministic guardrails that run AFTER the model. These exist because of the
// "confident but wrong feedback" failure mode: we don't trust the model's own
// claims about the answer unless we can verify them mechanically.
import { CRITERIA_KEYS } from './rubric.js';

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}$%]+/gu, ' ').trim(); // punctuation-insensitive: hyphen variants, curly quotes, ellipses

export function quoteExists(answer, quote) {
  if (!quote || quote.trim().length < 4) return false;
  return norm(answer).includes(norm(quote));
}

const NUM = /\b\d[\d,.]*\s?(%|k|m|x|ms|million|billion|hours?|days?|weeks?|months?|users?|\$)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|hundred)\s(?:weeks?|months?|days?|years?|engineers?|people|percent)\b/gi;
export const numbersIn = (s) => new Set((s.match(NUM) || []).map((n) => n.trim().toLowerCase()));

// Numbers in the "improved answer" that appear in neither the candidate's answer nor resume
// are invented. Placeholders like [X%] are the only allowed way to show a metric.
export function inventedNumbers(improved, ...sources) {
  const known = new Set();
  for (const s of sources) numbersIn(s || '').forEach((n) => known.add(n));
  return [...numbersIn(improved)].filter((n) => !known.has(n) && !/^\d$/.test(n)); // ignore lone digits ("3 steps")
}

export function clampScores(scores) {
  const out = {};
  for (const k of CRITERIA_KEYS) out[k] = Math.min(5, Math.max(1, Math.round(Number(scores?.[k]) || 1)));
  return out;
}

// spoken transcripts spell numbers out ("forty four percent"), so check words too
export const hasQuantity = (s) => /\d|\b(percent|per cent|million|billion|thousand|hundred|doubled|tripled|halved|twice)\b/i.test(s);

// "I don't know", "no idea", a couple of words: there is nothing to improve, so the app must not invent an answer.
const NON_ANSWER = /\b(don'?t|do not|didn'?t|did not) (really )?(know|remember|recall)\b|\bno idea\b|\bnot sure\b|\bcan'?t (think|recall|remember)\b|^\W*(pass|skip|nothing|none|idk|n\/?a)\W*$/i;
export function isNonAnswer(answer) {
  const n = (answer.trim().match(/\S+/g) || []).length;
  return n < 6 || (n < 16 && NON_ANSWER.test(answer));
}

// Word-overlap similarity, used to stop the coach "following up" by repeating the question.
const tokens = (s) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) || []));
export function tooSimilar(a, b, threshold = 0.45) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return false;
  let shared = 0; for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= threshold;
}
export const FOLLOW_UP_SCAFFOLD = 'Pick any project from your resume you are proud of: what was the goal, what did you personally build, and what was the result?';

const WORDS = (s) => (s.trim().match(/\S+/g) || []).length;

/**
 * Returns { evaluation, flags }. Flags are user-visible reliability signals.
 */
export function applyGuards(raw, { answer, resume, question = '' }) {
  const flags = [];
  const scores = clampScores(raw.scores);

  // 1. Evidence check: every strength/gap must quote the candidate verbatim.
  const checkEvidence = (items, kind) =>
    (items || []).filter((it) => {
      const ok = quoteExists(answer, it.quote);
      if (!ok) flags.push({ type: 'dropped_unverified_quote', detail: `Dropped a ${kind} whose quote isn't in the answer.` });
      return ok;
    });
  const nonAnswer = isNonAnswer(answer);
  const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.quote.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  // one quote can't be five separate findings; for a non-answer a single note is all there is to say
  const strengths = nonAnswer ? [] : uniq(checkEvidence(raw.strengths, 'strength'));
  const gaps = nonAnswer ? uniq(checkEvidence(raw.gaps, 'gap')).slice(0, 1) : uniq(checkEvidence(raw.gaps, 'gap'));

  // 2. Very short answers can't score high on impact/specificity/structure.
  const words = WORDS(answer);
  if (words < 25) {
    for (const k of ['structure', 'specificity', 'impact']) scores[k] = Math.min(scores[k], 2);
    flags.push({ type: 'too_short', detail: `Only ${words} words — scores capped; there's not enough to evaluate.` });
  }

  // 3. Impact 4–5 requires a quantity in the answer itself (digits or spelled-out figures).
  if (scores.impact >= 4 && !hasQuantity(answer)) {
    scores.impact = 3;
    flags.push({ type: 'impact_unsupported', detail: 'Impact needs a measurable result in your answer; capped at 3.' });
  }

  // 3b. Claims that contradict the resume: cap the scores that depend on believing them.
  const resume_conflicts = (raw.resume_conflicts || []).filter((c) => quoteExists(answer, c.quote));
  if (resume_conflicts.length) {
    scores.impact = Math.min(scores.impact, 3);
    scores.specificity = Math.min(scores.specificity, 3);
    flags.push({ type: 'resume_conflict', detail: `Your answer doesn't match your resume (${resume_conflicts.map((c) => `"${c.quote}": ${c.issue}`).join('; ')}). An interviewer will notice — scores capped until it's reconciled.` });
  }

  // 4. Improved answer must not invent facts. Numbers must come from answer/resume.
  let improved = raw.improved_answer || '';
  const invented = inventedNumbers(improved, answer, resume);
  if (invented.length) {
    flags.push({
      type: 'invented_numbers',
      detail: `The rewrite contained figures not found in your answer or resume (${invented.join(', ')}). Replace them with real ones or remove them.`,
    });
  }

  // 5. Low-confidence or fact-claim feedback is surfaced, not hidden.
  let confidence = ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium';
  const technical_claims_to_verify = (raw.technical_claims_to_verify || []).filter((c) => quoteExists(answer, c.quote));
  if (technical_claims_to_verify.length) {
    flags.push({ type: 'technical_claims', detail: 'Some technical statements in your answer could not be verified by the coach — double-check them.' });
  }
  if (resume_conflicts.length && confidence === 'high') confidence = 'medium';
  if (confidence === 'low') flags.push({ type: 'low_confidence', detail: 'The coach marked this evaluation as low confidence.' });

  return {
    evaluation: {
      scores,
      strengths,
      gaps,
      improved_answer: improved,
      confidence,
      technical_claims_to_verify,
      resume_conflicts,
      // never "follow up" a non-answer (or anything) by re-asking the question: give a concrete way in instead
      follow_up: raw.follow_up && (nonAnswer || (question && tooSimilar(raw.follow_up, question))) ? FOLLOW_UP_SCAFFOLD : raw.follow_up,
      non_answer: nonAnswer,
      summary: raw.summary,
    },
    flags,
  };
}

// Last resort: replace remaining invented figures in the rewrite with a placeholder.
export function redactInvented(improved, ...sources) {
  const bad = inventedNumbers(improved, ...sources);
  let out = improved;
  for (const n of bad) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[detail]');
  return out;
}
