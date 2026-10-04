# Evaluation framework

## 1. What is a "good answer"?
Five criteria, each scored 1–5 with anchored descriptions (see `lib/rubric.js`). Anchors matter: without them "4" means different things on different runs.

| Criterion | Question it answers | Why it's here |
|---|---|---|
| Relevance | Does it answer what was asked, for this role? | Interviewers penalise tangents first |
| Structure | Is there a situation → action → result arc? | Makes answers followable aloud |
| Specificity | Concrete, checkable detail about *your* actions? | Separates real experience from claims |
| Business impact | Outcome that matters, ideally quantified? | The most commonly missing element |
| Clarity | Concise, no filler, easy to follow? | Spoken answers need to land first time |

Principles the evaluator is told to follow: score what was *said* not what a strong candidate *would* say; polish and length are not substance; most real answers land at 2–4; a 5 needs strong evidence.

## 2. Two layers of evaluation
**A. Is the scoring accurate?** (`eval/cases.json`, `calibration` group) — answers with human labels per criterion. Metrics: MAE, bias (is the AI generous?), % within ±1, ranking agreement, run-to-run σ. **Caveat:** the shipped labels were written by the project author, a single rater. Replace/extend with ≥2 independent raters (e.g. a hiring manager and a recruiter) and report inter-rater agreement; the AI can't be expected to agree with humans more than they agree with each other.

**B. Does it fail safely?** (`adversarial` group) — each case targets a named failure mode with a machine-checkable expectation. See `failure-modes.md`.

## 3. Mitigations are layered
1. **Prompt rules** — quote-or-don't-claim, no length reward, calibrate, never assert technical corrections as certain.
2. **Deterministic guards after the model** (`lib/guards.js`) — drop any strength/gap whose quote isn't verbatim in the answer; cap scores on very short answers; require evidence for impact ≥4; flag numbers in the rewrite that appear in neither answer nor resume.
3. **Surfacing uncertainty** — confidence level, "please double-check" list, and visible flags instead of silently fixing.
4. **Human signal** — every feedback card has 👍/🤔/👎 + note, logged to `data/feedback.jsonl`.

## 4. Running it
```bash
npm run eval                              # everything, 1 run per case
node eval/run.js --runs 3 --only cal      # repeatability on calibration cases
```
Output: `eval/results/<timestamp>.md` (+ `.raw.json` with every evaluation, useful for picking good/bad feedback examples).

## 5. Success thresholds (proposed — adjust once you have baselines)
- Calibration: MAE ≤ 0.8, |bias| ≤ 0.3, ≥85% within ±1, σ ≤ 0.4
- Failure-mode suite: 100% pass on injection and invented-numbers; ≥80% elsewhere
- Real users: ≥70% rate feedback 👍/🤔; <10% 👎 "misleading"
