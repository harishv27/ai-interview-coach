# Engineering log: what went wrong and how it was fixed

Real problems found while building and testing this project, with how each was found and fixed. Evidence for the numbers is in `eval/results/` and the git history.

| # | Problem | How it was found | Fix | Guard against regression |
|---|---|---|---|---|
| 1 | The "stronger version" of an answer invented facts ("20% ease-of-use", "six weeks", "executive review") | Adversarial case `adv-05`; the first number check caught only one of the three | Rewrite is built from an explicit list of allowed facts; a separate fact-check call removes unsupported claims; leftover figures are redacted | `adv-05`, unit tests for invented numbers |
| 2 | An answer claiming "25 engineers, $2M → $40M" scored impact 5 even though the resume said otherwise | Case `adv-07` | The scorer lists claims that contradict the resume; those cap impact and specificity and are flagged to the user | `adv-07`, `adv-10`, unit test |
| 3 | Evidence quotes were dropped as "not found" even when the candidate said them | Guardrail counters showed ~40 drops per run; traced to Unicode hyphens and curly quotes | Punctuation-insensitive quote matching | Unit test |
| 4 | Scoring took minutes | Timing logs showed one request stuck in retries | Found two causes: requests reserved far more tokens than they used (Groq counts `max_tokens` against the per-minute limit), and the main model's *daily* quota was exhausted. Fix: realistic token requests, release reservations on failures, fail fast on daily quota with automatic fallback to the smaller model | Three unit tests with a stubbed network |
| 5 | PDF upload failed only on the hosted site | Worked locally; hosted logs showed a missing native graphics module | Replaced the PDF library with a canvas-free one built for serverless | API test with a real PDF fixture |
| 6 | Answering "don't know" produced a full invented answer and a follow-up that repeated the question | A real session pasted back by the project owner | Non-answers get an outline built from the resume instead; follow-ups that repeat the question are replaced; duplicate findings collapse to one | Unit and API tests, `adv-08` |
| 7 | Speech recognition heard "Readees cache for a Fastopee service" | Real Whisper test with a recorded sentence | Names and jargon from the resume and job are passed as a vocabulary hint; silence returns empty text instead of an invented phrase | Real-service check, mock-service API test |
| 8 | Evaluation runs were slow and sometimes hung | Runs took 30+ minutes | Same root causes as #4, plus request timeouts and per-attempt logging | `LLM_TIMING=1` logs |
| 9 | The scorer was about 0.3 points too generous (product-manager set) | Calibration against human labels | Hard per-criterion caps, calibration examples and code-level checks. On the engineering set the bias is now +0.17 | Quality gate in the evaluation |
| 10 | Conceptual and design answers got impact 1 ("no outcome") when a fair score is about 3 | First run on the engineering set: impact was 2 points low on RAG-evaluation, caching, design and SQL answers | The impact rule contradicted itself ("no outcome = 1" vs "conceptual answers have no outcome"); rewritten so conceptual answers are judged on consequences, trade-offs and how success is measured. Impact error fell from 0.79 to 0.54 and ranking agreement rose from 94% to 98% | Calibration cases `cal-05/07/08/20/21/23` |
| 11 | A brief network drop failed four evaluation cases in a row | "Model did not return valid JSON (TypeError)" — the cause was a dropped connection that my retry loop re-tried instantly six times | Exponential backoff between network retries and the error cause recorded | Unit test with a stubbed network |
| 12 | Groq sometimes rejects the model's JSON itself (HTTP 400 `json_validate_failed`) | One evaluation case errored | Treated as retryable | Unit test |
| 13 | Rate-limit waits were longer than necessary (p50 61s in one run) | Latency numbers in the evaluation report | The token estimate assumed 3.2 characters per token (real figure is about 4) and padded the reservation; both corrected. p50 per answer is now 11s during back-to-back evaluation runs | Latency recorded in every evaluation run |

## Candidate change awaiting validation
| # | Change | Evidence so far | Why it is not shipped |
|---|---|---|---|
| 14 | Stricter **structure** rule: a vague result ("it went well", "it worked") counts as no result (max 3), and conceptual or design answers are judged on logical order (clarify → approach → trade-offs → verify) so a well-ordered technical answer can score 4–5 | Structure was the weakest criterion (error 0.79; over-credits vague stories, under-credits ordered technical answers; the same pattern appeared on the held-out set). On the 21 dev cases scored by the main model in both runs, structure error fell from 0.81 to 0.48 and overall error from 0.51 to 0.39 | The rule was tuned on those same dev cases, so that gain is expected; the held-out cases (10, labelled before tuning) could not be scored properly because the main model's daily free quota ran out partway through the run (39% of answers fell back to the smaller model). Re-run on a day with quota, check the held-out error, and only then ship |

**Baseline for that check** (current rules, held-out set, main model for every answer): error 0.52, bias 0.00, 98% of scores within ±1.

## Lessons about evaluating on a free tier
- A 44-case run uses roughly 130,000 tokens of the main model's 200,000-token daily allowance; four large runs in one day exhausted it. The runner now reports the share of answers scored by the backup model and refuses to treat such a run as valid evidence.
- Partial runs (`--only`, `--ids`) are no longer written to the history, and held-out results are reported separately so tuning on the dev set cannot flatter the headline number.

## Things that were tried and not kept
- Padding `max_tokens` "to be safe": made the rate limit worse (#4).
- Waiting out rate limits: made requests look frozen; failing fast with a clear message is better.
- Showing per-question scores in the live interview: contradicts the idea of a realistic round, so scores appear only in the final report.
