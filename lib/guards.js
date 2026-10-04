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

const WORDS = (s) => (s.trim().match(/\S+/g) || []).length;

/**
 * Returns { evaluation, flags }. Flags are user-visible reliability signals.
 */
export function applyGuards(raw, { answer, resume }) {
  const flags = [];
  const scores = clampScores(raw.scores);

  // 1. Evidence check: every strength/gap must quote the candidate verbatim.
  const checkEvidence = (items, kind) =>
    (items || []).filter((it) => {
      const ok = quoteExists(answer, it.quote);
      if (!ok) flags.push({ type: 'dropped_unverified_quote', detail: `Dropped a ${kind} whose quote isn't in the answer.` });
      return ok;
    });
  const strengths = checkEvidence(raw.strengths, 'strength');
  const gaps = checkEvidence(raw.gaps, 'gap');

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
      follow_up: raw.follow_up,
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
