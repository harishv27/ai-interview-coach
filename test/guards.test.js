import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuards, quoteExists, inventedNumbers } from '../lib/guards.js';

const scores = { relevance: 5, structure: 5, specificity: 5, impact: 5, clarity: 5 };
const long = 'I ran a test on the onboarding wizard and we moved the connection step later. '.repeat(3);

test('quoteExists is whitespace/case/quote-style tolerant, rejects fabricated quotes', () => {
  assert.ok(quoteExists('We shipped it  on time.', 'we shipped it on time'));
  assert.ok(!quoteExists('We shipped it', 'we doubled revenue'));
  assert.ok(!quoteExists('anything', ''));
});

test('unverifiable strengths/gaps are dropped and flagged', () => {
  const { evaluation, flags } = applyGuards(
    { scores, strengths: [{ criterion: 'impact', quote: 'I tripled revenue', comment: 'x' }], gaps: [{ criterion: 'structure', quote: 'moved the connection step later', comment: 'y' }], improved_answer: '', confidence: 'high', technical_claims_to_verify: [] },
    { answer: long, resume: '' });
  assert.equal(evaluation.strengths.length, 0);
  assert.equal(evaluation.gaps.length, 1);
  assert.ok(flags.some((f) => f.type === 'dropped_unverified_quote'));
});

test('short answers are capped', () => {
  const { evaluation, flags } = applyGuards({ scores, strengths: [], gaps: [], improved_answer: '', confidence: 'high' }, { answer: 'I like growth.', resume: '' });
  assert.ok(evaluation.scores.impact <= 2 && evaluation.scores.structure <= 2);
  assert.ok(flags.some((f) => f.type === 'too_short'));
});

test('impact 5 with no numbers or evidence is lowered', () => {
  const { evaluation } = applyGuards({ scores, strengths: [], gaps: [], improved_answer: '', confidence: 'high' }, { answer: long, resume: '' });
  assert.equal(evaluation.scores.impact, 3);
});

test('invented numbers in the rewrite are detected; placeholders and known numbers are fine', () => {
  assert.equal(inventedNumbers('Lifted activation to 44% and saved $2M', 'activation went to 44%', '').length, 1);
  assert.ok(inventedNumbers('We grew revenue 300%', 'we grew revenue', 'resume 31%').length === 1);
  assert.equal(inventedNumbers('We grew revenue [X%]', 'we grew revenue', '').length, 0);
  assert.equal(inventedNumbers('From 31% to 44%', 'it went from 31% to 44%', '').length, 0);
});

test('scores are clamped to 1..5 integers', () => {
  const { evaluation } = applyGuards({ scores: { relevance: 9, structure: 0, specificity: 3.6, impact: 'x', clarity: 2 }, strengths: [], gaps: [], improved_answer: '' }, { answer: long, resume: '' });
  assert.deepEqual(Object.values(evaluation.scores), [5, 1, 4, 1, 2]);
});

import { redactInvented } from '../lib/guards.js';
test('resume conflicts cap impact/specificity and are flagged', () => {
  const ans = 'I led 25 engineers and grew revenue from $2M to $40M in a year by launching the enterprise tier on my own.';
  const { evaluation, flags } = applyGuards({ scores, strengths: [], gaps: [], improved_answer: '', confidence: 'high', resume_conflicts: [{ quote: 'led 25 engineers', issue: 'resume says 4 engineers' }, { quote: 'not in answer', issue: 'x' }] }, { answer: ans, resume: '' });
  assert.ok(evaluation.scores.impact <= 3 && evaluation.scores.specificity <= 3);
  assert.equal(evaluation.resume_conflicts.length, 1);
  assert.equal(evaluation.confidence, 'medium');
  assert.ok(flags.some((f) => f.type === 'resume_conflict'));
});
test('spelled-out and magnitude figures in a rewrite are caught and redacted', () => {
  assert.ok(inventedNumbers('It shipped within six weeks', 'we shipped it', '').length === 1);
  assert.match(redactInvented('Revenue hit $40 million in six weeks', 'revenue grew', ''), /\[detail\]/);
});

test('quote matching ignores unicode hyphens, curly quotes and ellipses', () => {
  assert.ok(quoteExists('We ran a data-driven “working session” on it.', 'data‑driven "working session"...'));
});

import { isNonAnswer, tooSimilar, FOLLOW_UP_SCAFFOLD } from '../lib/guards.js';
test('non-answers are detected, real short answers are not', () => {
  for (const a of ["don't know", 'I do not really know', 'no idea', 'pass', 'um not sure', 'yes']) assert.ok(isNonAnswer(a), a);
  assert.ok(!isNonAnswer('I added a Redis cache and cut p95 latency from 900ms to 300ms.'));
  assert.ok(!isNonAnswer("I don't know the exact number, but I led the migration of our Postgres cluster to a new region and we finished two weeks early."));
});
test('a follow-up that merely repeats the question is replaced with a concrete prompt', () => {
  assert.ok(tooSimilar('Can you describe a specific project where you took full ownership from concept to production?', 'Can you tell me about a time you took full ownership of a project from concept to production?'));
  assert.ok(!tooSimilar('What trade-offs did you weigh when choosing Redis over Memcached?', 'Tell me about a time you improved performance.'));
  const q = 'Tell me about a time you took full ownership of a project from concept to production.';
  const { evaluation } = applyGuards({ scores, strengths: [], gaps: [], improved_answer: '', confidence: 'high', follow_up: 'Can you describe a project where you took full ownership from concept to production?' }, { answer: long, resume: '', question: q });
  assert.equal(evaluation.follow_up, FOLLOW_UP_SCAFFOLD);
});
test('for a non-answer: no strengths, a single gap, flagged as non-answer', () => {
  const raw = { scores, strengths: [{ criterion: 'clarity', quote: "don't know", comment: 'x' }], confidence: 'high',
    gaps: ['relevance', 'structure', 'specificity', 'impact'].map((c) => ({ criterion: c, quote: "don't know", comment: c })), improved_answer: '' };
  const { evaluation } = applyGuards(raw, { answer: "don't know", resume: '', question: 'Q?' });
  assert.equal(evaluation.non_answer, true); assert.equal(evaluation.strengths.length, 0); assert.equal(evaluation.gaps.length, 1);
  const withFollow = applyGuards({ ...raw, follow_up: 'Could you walk me through a different project in detail?' }, { answer: "don't know", resume: '', question: 'Q?' });
  assert.equal(withFollow.evaluation.follow_up, FOLLOW_UP_SCAFFOLD, 'a non-answer always gets the concrete prompt');
});
test('repeated quotes collapse to one finding for a real answer too', () => {
  const quote = 'moved the connection step later';
  const raw = { scores, strengths: [], confidence: 'high', improved_answer: '', gaps: [{ criterion: 'structure', quote, comment: 'a' }, { criterion: 'impact', quote, comment: 'b' }] };
  assert.equal(applyGuards(raw, { answer: long, resume: '', question: '' }).evaluation.gaps.length, 1);
});
