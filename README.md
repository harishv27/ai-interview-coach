# AI Interview Coach

[![CI](https://github.com/harishv27/ai-interview-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/harishv27/ai-interview-coach/actions/workflows/ci.yml)
[![Eval](https://github.com/harishv27/ai-interview-coach/actions/workflows/eval.yml/badge.svg)](https://github.com/harishv27/ai-interview-coach/actions/workflows/eval.yml)
[**Live demo**](https://ai-interview-coach-nine-plum.vercel.app)

A mock-interview app for software and AI engineers. You upload your resume, paste a job posting and pick a role (AI engineer, SDE, backend, frontend, full-stack, ML, data, DevOps). The coach then asks questions tailored to both, scores each answer, asks a follow-up, and shows you a stronger version of what you said.

Most "AI feedback" tools just sound confident. This project is as much about **checking the feedback** as generating it, so every score is backed by a quote from your own answer, and the app tells you when it isn't sure.

## What it does

- **Tailored questions** from your resume and the job posting (your stack, projects and the role's requirements), with a heads-up on the requirements your resume doesn't clearly cover.
- **Text or voice.** In voice mode the question is read aloud and you answer with your microphone, using your browser's built-in speech tools.
- **Scores on five criteria:** relevance, structure, specificity, business impact and clarity. Each is a 1–5 score with written definitions, so a "4" means the same thing every time (see `lib/rubric.js`).
- **Evidence for everything.** Each strength and weakness quotes your exact words. The server checks the quote really is in your answer and drops it if not.
- **A rewritten answer** built only from facts in your answer and resume. Anything unknown becomes a `[placeholder]` for you to fill in, never an invented number.
- **Delivery stats:** filler words, speaking pace and overly long sentences.
- **Retry any answer** and see whether your score improved. The debrief counts your best attempt.
- **Progress tracking** stored in your browser only, plus a downloadable report and score card.
- Focus modes: mixed, behavioural, technical depth and system design (including LLM/RAG design for AI roles), plus a tougher difficulty and a light/dark theme.

## How the feedback is kept honest

The core question behind this project: *what happens when the feedback is confidently wrong?* The approach has three layers.

1. **Clear rules in the prompt:** a hard cap per criterion (for example, no measurable result means impact can't exceed 3), a few worked examples, and an instruction to never state a technical correction as certain.
2. **Checks in code after the model answers** (`lib/guards.js`): quotes must appear in the answer, very short answers can't score high, a high impact score needs an actual number, claims that contradict the resume cap the score, and any figure in the rewrite that isn't in your answer or resume is removed.
3. **A second pass** where a separate call fact-checks the rewrite and strips anything unsupported.

When something looks shaky, the app shows a confidence level and a list of reliability notes instead of hiding it. The details, including known failure modes and what was tried, are in [docs/failure-modes.md](docs/failure-modes.md) and [docs/evaluation-framework.md](docs/evaluation-framework.md).

<!-- perf:start -->
### Latest evaluation ⚠️

| Metric | Latest | Target |
|---|---|---|
| Calibration MAE vs human labels | **0.53** | ≤ 0.80 |
| Bias (+ = AI too generous) | **+0.35** | within ±0.30 |
| Scores within ±1 of human | **98%** | ≥ 85% |
| Ranking agreement | **18/18** | 100% |
| Failure-mode tests passed | **6/7** | 100% |
| Latency per answer (p50 / p95) | **not yet measured** | < 15s p50 |
| Tokens per answer | **—** | — |

<sub>Latest run: 2026-10-04 01:55 UTC · `openai/gpt-oss-120b` · 15 cases × 2 run(s) · local</sub>

[Full history & trend →](docs/PERFORMANCE.md) · [Usage & user feedback →](docs/USAGE.md)
<!-- perf:end -->

## Getting started

You need Node 20 or newer and a [Groq](https://console.groq.com) API key (the free tier works).

```bash
git clone https://github.com/harishv27/ai-interview-coach.git
cd ai-interview-coach
npm install
cp .env.example .env      # then add your GROQ_API_KEY
npm start                 # http://localhost:3000
```

Voice mode works best in Chrome, Edge or Safari. Typing works everywhere.

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `GROQ_API_KEY` | none | Required |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model used for scoring |
| `GROQ_MODEL_FAST` | `openai/gpt-oss-20b` | Smaller model for the rewrite and fact-check |
| `GROQ_TPM` | `7000` | Local tokens-per-minute throttle. Groq's free tier allows 8,000 per minute per model |
| `RATE_LIMIT_PER_HOUR` | `60` | Per-IP limit on model-backed endpoints |
| `DAILY_CAP` | `400` | App-wide daily cap on scored answers |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | none | Optional. Makes the limits shared across serverless instances |
| `LLM_MOCK=1` | off | Use a fake model, handy for tests and offline UI work |

## Tests and evaluation

```bash
npm test            # unit + API tests, no API key or network needed
npm run eval        # runs the scoring evaluation against the live model
npm run report      # regenerates docs/PERFORMANCE.md from the eval history
npm run usage       # summarises local usage into docs/USAGE.md (counts only)
```

The evaluation has two parts: labelled answers to measure how closely the scores match human judgement, and adversarial cases (buzzword padding, injected instructions, invented numbers and so on) that must be handled safely. GitHub Actions runs the tests on every push and the full evaluation weekly.

## Project layout

| Path | Purpose |
|---|---|
| `public/` | The single-page front end and privacy page |
| `server.js` | Express API (also runs on Vercel) |
| `lib/rubric.js` | The definition of a good answer |
| `lib/coach.js` | Question planning, scoring, rewriting, debrief |
| `lib/guards.js` | Post-model checks |
| `lib/llm.js` | Model client with throttling and usage metrics |
| `lib/privacy.js`, `lib/delivery.js`, `lib/ratelimit.js` | Redaction, speech stats, rate limiting |
| `eval/` | Labelled cases, adversarial cases, runner, results |
| `scripts/` | Report generators |
| `docs/` | Evaluation framework, failure modes, user-research kit, generated performance and usage pages |

## Privacy

There are no accounts and no database. Emails, phone numbers and links are stripped from your text before it is sent to the model or logged, and your progress history lives only in your browser. See [public/privacy.html](public/privacy.html) for the plain-language version.

## Limitations

- The evaluation set is still based on product-manager answers; an engineering-specific set is the next thing to build, so the accuracy numbers above don't yet describe engineering answers.
- Scores are an aid to practice, not a prediction of how a real interviewer will rate you. The model still leans a little generous.
- The calibration labels come from a single rater so far. More independent raters would make the accuracy numbers more trustworthy.
- Voice mode relies on the browser's speech recognition, so quality varies, and delivery stats are based on the transcript rather than the audio.
- On Groq's free tier the main model allows roughly 60 scored answers a day (200,000 tokens) and about two a minute, shared by every user. When that runs out the app automatically falls back to a smaller model (answers are flagged as less reliable) and shows a clear message if both are exhausted. Use a paid key for anything beyond personal use, and give the scheduled evaluation its own key so it doesn't use up the app's daily allowance.
- The planned real-user testing sessions (see [docs/user-research.md](docs/user-research.md)) haven't happened yet, so there is no user feedback data to report.

## Deploying

The app runs on Vercel with no extra configuration (`vercel.json` is included). Add `GROQ_API_KEY` as an environment variable, and optionally the Upstash variables for shared rate limits.
