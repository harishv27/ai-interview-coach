# Failure-mode analysis: confident but wrong feedback

> **Current results (engineering set `eng-v1`):** 10 of 10 failure-mode tests pass; calibration error 0.53, bias +0.17, 97% of scores within ±1 of the human label, ranking agreement 176/180. Single rater (the project author), 24 calibration + 10 adversarial cases. The older product-manager results below (`pm-v1`) are kept for the history of how the guardrails were built.

The risk is not "feedback is bad" — it's feedback that **sounds authoritative and is wrong**, because a candidate will act on it (reuse a fabricated metric, adopt a wrong technical claim, stop improving because they scored "5").

| # | Failure mode | Why it matters | Mitigation | Test case |
|---|---|---|---|---|
| F1 | Buzzword fluff scored highly | Candidate believes jargon works | Rubric anchors; "polish ≠ substance"; impact≥4 needs evidence | `adv-01` |
| F2 | AI endorses/“corrects” technical claims incorrectly | Wrong statistics/engineering advice delivered confidently | Never assert corrections as certain → `technical_claims_to_verify` + confidence | `adv-02`, `adv-07` |
| F3 | Prompt injection inside answer/resume | Inflated scores, trust collapse | Untrusted-data framing; scores judged on content | `adv-03` |
| F4 | Length bias | Rambling rewarded | Explicit rule; concision examples | `adv-04`, `adv-06` |
| F5 | Rewrite invents metrics/employers | Candidate repeats a lie in a real interview | Placeholders only; `inventedNumbers` check flags figures not in answer/resume | `adv-05` |
| F6 | Feedback cites words the candidate never said | Erodes trust, hides hallucination | Verbatim-quote requirement, verified in code; unverified items dropped | unit tests |
| F7 | Over-penalising brevity (guard overcorrects) | A complete 40-word answer scored low | Cap applies only <25 words; tested | `adv-06` |
| F8 | Speech-to-text noise treated as bad content | Voice users unfairly marked down | *Open* — measure with `cal-08` | `cal-08` |
| F9 | Score instability (same answer, different score) | Can't track progress | Temperature 0.1; measure σ with `--runs 3` | calibration σ |
| F10 | Resume contradicts answer, AI doesn't notice | Misses what a real interviewer would probe | Surface via low confidence/flag | `adv-07` |
| F11 | Bias toward certain styles/accents/cultural communication norms | Unfair scores | *Open* — requires diverse real-user data; see user-research | — |

## Observed results (fill from `npm run eval`)
| Run date | Model | Calibration MAE | Bias | Within ±1 | Failure-mode pass | Notes |
|---|---|---|---|---|---|---|
| 2026-10-04 #1 (baseline) | gpt-oss-120b via Groq | 0.47 | +0.28 | 100% | 6/7 | `adv-05` fail: rewrite invented facts |
| 2026-10-04 #2 (after fixes) | gpt-oss-120b via Groq | 0.51 | +0.31 | 98% | 7/7 | 2 runs/case; ranking agreement 18/18 |
| 2026-10-04 #3 (same code as #2) | gpt-oss-120b via Groq | 0.53 | +0.35 | 98% | 6/7 | Same code, different pass count → run-to-run variance is real |

Reports: `eval/results/*.md`. Single human rater, 8 calibration cases, so treat these as a baseline, not proof.

## Examples of good / bad feedback (pull from `eval/results/*.raw.json` and `data/turns.jsonl`)
| | Answer excerpt | Feedback | Why good/bad |
|---|---|---|---|
| Good | | | |
| Bad (caught by guard) | | | |
| Bad (missed by guard) | | | |

## Iteration log
| # | What failed | Evidence | Change | Result after |
|---|---|---|---|---|
| 1 | `adv-05`: rewrite invented "20% ease-of-use", "six weeks", "executive review". The number check caught only "13"; "20%" collided with an unrelated resume figure and "six" is a word | run #1 raw output | Added a separate fact-checker call that removes unsupported claims from the rewrite; regex now covers spelled-out numbers; leftovers are redacted to `[detail]` | `adv-05` passed in #2, but the audit repaired ~28 of ~30 rewrites, so the model invents in almost every rewrite |
| 2 | `adv-07`: answer claiming "25 engineers, $2M→$40M" contradicting the resume got impact 5 | run #1 raw output | New `resume_conflicts` field; verified quote caps impact/specificity at 3, lowers confidence, shows a flag | Pass in #2/#3 (overall 3.8) — still generous |
| 3 | 43 evidence quotes dropped as "not verbatim" per run (likely unicode hyphens/quotes) | guardrail counts in #2 | Punctuation-insensitive quote matching + unit test | **Not yet re-validated by a full eval run** (runs hung on the API) |
| Open | AI is ~0.3 too generous, mostly on structure/specificity/impact when metrics are missing; `adv-02` (wrong p-value claim) scores 3.0 — flagged but not low | #2 table | Next: stricter impact anchors, few-shot calibration examples | |
