# AI Interview Coach

A web app that runs a tailored mock interview from your resume + a job description, scores each answer on an explicit rubric, asks follow-ups, and rewrites your answer — **plus the evaluation work that asks "what happens when the AI is confidently wrong?"**

## Run it
```bash
npm install
cp .env.example .env     # add GROQ_API_KEY (or ANTHROPIC_API_KEY)
npm start                # http://localhost:3000
```
Voice mode (checkbox on the setup screen) uses the browser's built-in speech synthesis + recognition — best in Chrome/Edge/Safari. Typing always works.

## What's here
| Path | Purpose |
|---|---|
| `public/index.html` | The app: setup → interview (text or voice) → per-answer feedback → debrief |
| `lib/rubric.js` | **The definition of a good answer** (5 criteria, 1/3/5 anchors). Shared by the prompt, UI and eval |
| `lib/coach.js` | Question planning, answer evaluation, session debrief (structured output via tool-use) |
| `lib/guards.js` | Deterministic post-checks: quote verification, score caps, invented-number detection |
| `eval/` | Labelled calibration set + adversarial failure-mode cases + runner (`npm run eval`) |
| `test/` | Unit tests for guardrails, no API key needed (`npm test`) |
| `docs/evaluation-framework.md` | Rubric rationale, metrics, how to run & read the eval |
| `docs/failure-modes.md` | Failure taxonomy, mitigations, and a log to fill with observed results |
| `docs/user-research.md` | Protocol, interview script and results template for 5 real job seekers |
| `data/*.jsonl` | Local logs of turns and user accuracy ratings (git-ignored) — raw material for the research |

## Evidence workflow
1. `npm run eval` → `eval/results/*.md` (calibration vs human labels, failure-mode pass rate). Paste into `docs/failure-modes.md`.
2. Fix what fails, re-run, record before/after in the "Iteration log".
3. Run 5 job-seeker sessions with `docs/user-research.md`; the in-app 👍/🤔/👎 ratings land in `data/feedback.jsonl`.

## Status
- Works end to end on Groq (`openai/gpt-oss-120b`) or Anthropic. Eval baseline and iteration log are in `docs/failure-modes.md` (single human rater, 8 calibration + 7 adversarial cases).
- Known gaps: the AI scores ~0.3 too generous; the quote-matching fix has a unit test but no full eval re-run; eval runs are slow and can hang on the API.
- **Not yet done:** the 5 real job-seeker sessions (`docs/user-research.md` results table is intentionally empty).
