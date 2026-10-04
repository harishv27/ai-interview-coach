# User research with real job seekers (target: 5)

## Recruit
Active or recent job seekers in/near the target role (e.g. PM). Mix of seniority and at least one non-native English speaker (probes F8/F11). Don't use friends who'll be polite — ask for candour.

## Session (≈35 min, screen-shared)
1. **Before (3 min):** "How do you practise today? How confident are you in your answers (1–5)?"
2. **Task (15 min):** they use *their own* resume and a *real* JD, 3–5 questions, voice mode if comfortable. Don't coach. Note where they hesitate.
3. **Per answer:** before reading the feedback, ask "How do you think that went (1–5)?" Then compare to the AI score; ask them to rate 👍/🤔/👎.
4. **After (10 min):** 
   - Which feedback was most useful? Anything wrong or that felt generic?
   - Did the rewrite sound like you? Would you say it? Did any bracketed placeholder confuse you?
   - Did you trust the scores? What would make you trust them more?
   - Voice vs text — did speaking change how you answered?
   - Would you use this again before a real interview? (1–5) What would you pay/where would you use it?
5. **Optional validity check:** ask a hiring manager/recruiter to score 2–3 of the same answers blind; add to `eval/cases.json` as human labels.

## Metrics to capture per participant
Self-predicted vs AI score gap · 👍/🤔/👎 counts · # feedback items they called wrong (with example) · rewrite adopted? (Y/N/partly) · confidence before/after · return intent.

## Results (fill in — do not fabricate)
| P | Role / level | Voice? | Self vs AI gap | 👍/🤔/👎 | Wrong/misleading examples | Confidence Δ | Top quote |
|---|---|---|---|---|---|---|---|
| P1 | | | | | | | |
| P2 | | | | | | | |
| P3 | | | | | | | |
| P4 | | | | | | | |
| P5 | | | | | | | |

## Findings → changes
| Finding | #participants | Change shipped | Re-test outcome |
|---|---|---|---|
| | | | |

Consent: tell participants their resume/answers go to an LLM API and are logged locally; delete `data/*.jsonl` rows on request; anonymise before publishing.
