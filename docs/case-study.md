# Case study: an interview coach that checks its own feedback

## The problem
People practise interview answers but can't tell whether the feedback they get is any good. AI feedback is especially risky because it sounds equally confident when it is right and when it is wrong, and a candidate may act on a made-up metric or a wrong technical claim.

## What I built
A web app for software and AI engineering candidates. You add a resume and a job posting; it asks tailored questions (by typing or in a hands-free live voice interview), scores each answer on five criteria, asks a follow-up and shows a stronger version of the answer. The live voice mode listens, replies out loud and gives a scored report at the end, like a real round.

## Defining "good"
Before writing any prompts I defined five criteria with written 1/3/5 anchors and hard rules: relevance, structure, specificity, business impact and clarity ([lib/rubric.js](../lib/rubric.js)). The prompt, the interface and the evaluation all use that single definition, so "a 4" means one thing everywhere.

## Treating wrong feedback as the main risk
The question driving the design: *what happens when the feedback is confidently wrong?* Three layers:
1. **Rules in the prompt:** per-criterion caps, calibration examples, never assert a technical correction as certain.
2. **Checks in code:** every strength or gap must quote the candidate verbatim (verified, otherwise dropped); very short answers can't score high; claims that contradict the resume cap the score; figures that aren't in the answer or resume are removed from the rewrite.
3. **Say when unsure:** a confidence level and visible reliability notes instead of silently fixing.

## How I measured it
- A labelled calibration set of 24 engineering answers, 10 adversarial cases (buzzwords, injected instructions, a made-up library, a confident technical error, a false resume claim, "don't know"), and 10 held-out cases written and labelled before any tuning. All labels are mine, so this is a single-rater result and I say so.
- Metrics: error against my labels, bias (is it too generous?), agreement within one point, ranking agreement, run-to-run variance, latency and tokens.

## Results (engineering set, main model, no fallback)
| Measure | Result |
|---|---|
| Average error vs labels | 0.53 (target ≤ 0.8) |
| Bias | +0.17 (the first version was about +0.3) |
| Within one point of my label | 97% |
| Ranking agreement | 176 of 180 pairs |
| Adversarial tests | 10 of 10 |
| Held-out baseline | error 0.52, bias 0.00, 98% within one point |

Full history and trend: [PERFORMANCE.md](PERFORMANCE.md).

## What went wrong (and was fixed)
The most instructive failures, found by testing rather than assumed ([full log](engineering-log.md)):
- **Invented answers.** The "stronger version" added facts the candidate never gave. Fixed with an explicit allowed-facts step, a separate fact-check pass and a number check. A later real session showed the same problem for a "don't know" answer, which now gets an outline built from the resume instead.
- **Contradicting the resume.** An answer claiming a team of 25 and big revenue still scored top marks. The scorer now flags claims that conflict with the resume and caps the scores they depend on.
- **A rule that contradicted itself.** The impact rule scored conceptual answers 1 because they have "no outcome", about two points too low. Found by the first engineering run; the rule was rewritten and ranking agreement rose from 94% to 98%.
- **Minutes-long scoring.** Traced with per-call timing to two causes: over-reserved tokens against the provider's per-minute limit, and the main model's daily free quota running out. Fixed with realistic requests, immediate fallback to a smaller model and clear messages.
- **PDF upload broke only in production.** A native dependency missing on the host; replaced with a serverless-friendly library and a regression test.

## Decisions and trade-offs
- No accounts or database: free to host and no personal data on the server; history stays in the browser.
- Contact details are stripped before any model call or log line.
- A cheaper model handles rewrites, fact-checks and live-interview reactions (short, latency-sensitive), the main model handles scoring.
- In the live interview the interviewer listens only when it isn't speaking: simpler and robust across browsers.
- Evidence discipline: partial and invalid runs aren't recorded, held-out results are reported separately, and a promising rule change was not shipped until it can be validated on the held-out set.

## Limits
- Single rater; the accuracy numbers would be stronger with two or three independent raters.
- Free-tier model limits cap throughput (roughly 60–80 scored answers a day).
- Delivery coaching uses the transcript, not the audio, so tone and accent aren't assessed.
- No user study yet; the kit for running one is in [user-research.md](user-research.md).

## What I would do next
1. Validate the pending structure-rule change on the held-out set.
2. Get independent raters and publish agreement between them.
3. Run five to ten sessions with real job seekers and feed their ratings back into the evaluation set.
4. Stream audio for faster, interruptible conversation and add audio-based delivery feedback.
