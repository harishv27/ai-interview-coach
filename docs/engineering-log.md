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
| 9 | The scorer was about 0.3 points too generous | Calibration against human labels | See `docs/PERFORMANCE.md` for the measured effect of each change | Quality gate in the evaluation |

## Things that were tried and not kept
- Padding `max_tokens` "to be safe": made the rate limit worse (#4).
- Waiting out rate limits: made requests look frozen; failing fast with a clear message is better.
- Showing per-question scores in the live interview: contradicts the idea of a realistic round, so scores appear only in the final report.
