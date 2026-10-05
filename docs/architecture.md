# Architecture

A small Express API plus a single-page front end. There is no database and no user accounts: all long-lived state lives in the browser, and the model providers are called from the server.

```mermaid
flowchart LR
  B[Browser<br/>single-page app] -->|resume, job, answers| API[Express API<br/>Vercel serverless]
  B -->|audio clips| API
  API -->|scoring · rewrite · fact-check| LLM[(Groq LLMs<br/>120b + 20b)]
  API -->|speech to text| STT[(Whisper)]
  API -->|text to speech| TTS[(Orpheus voice)]
  API --> G[Guardrails<br/>lib/guards.js]
  API --> L[Redacted logs]
  B --- LS[(localStorage<br/>draft · history)]
```

## Scoring one answer

```mermaid
sequenceDiagram
  participant U as Browser
  participant S as Server
  participant M as Main model (120b)
  participant F as Fast model (20b)
  U->>S: answer + question + resume + job
  S->>S: strip emails/phones/links
  par scoring and rewriting in parallel
    S->>M: score against rubric (JSON)
    S->>F: list allowed facts, then write rewrite
  end
  S->>S: guards: verify quotes, cap scores, check resume conflicts
  S->>F: fact-check the rewrite against answer + resume
  S->>S: remove invented numbers, add reliability flags
  S-->>U: scores, evidence, rewrite, flags, delivery stats
```

If the main model's daily free quota is exhausted, the scoring call switches to the smaller model immediately and the answer is flagged as less reliable.

## Live voice interview

```mermaid
sequenceDiagram
  participant U as Browser (mic + speaker)
  participant S as Server
  U->>S: plan questions
  loop each question
    U->>S: text to speech (interviewer line)
    S-->>U: audio (or browser voice fallback)
    U->>U: record, detect end of speech from silence
    U->>S: audio + vocabulary hint
    S-->>U: transcript
    U->>S: interviewer turn (acknowledge, maybe one follow-up)
    S-->>U: short spoken reaction
    U-)S: score this question in the background
  end
  U->>U: wait for scoring to finish, show the report
```

The conversation is half-duplex (it never listens while speaking), so no echo cancellation of the interviewer's voice is needed.

## Design decisions

| Decision | Why |
|---|---|
| Rubric in one file (`lib/rubric.js`) | The prompt, the UI and the evaluation all use the same definition of a good answer |
| Structured JSON output, schema-checked | Free-form model text is brittle; every field the UI needs is validated or defaulted |
| Guards in code after the model | Anything that can be checked mechanically (quote exists, number in source, score caps) should not rely on the model's own claims |
| Separate fact-check pass for the rewrite | A second call with only the sources and the rewrite catches invented facts that regexes can't |
| Cheaper model for rewrite, fact-check and interviewer turns | They are short and latency-sensitive; they also use a different free-tier token bucket |
| No accounts or database | Keeps the project free to host and removes personal data from the server; history is stored locally |
| Contact details stripped before any model call or log | They are never needed to coach an answer |
| Half-duplex voice with silence detection | Simple, robust across browsers, and avoids echo problems |

## Limits of this design

- Free-tier AI limits cap throughput (roughly 60–80 scored answers a day on the main model). A paid key removes this.
- Rate limits are per serverless instance unless the optional shared store is configured.
- Speech quality depends on the browser and microphone; delivery statistics use the transcript, not the audio.
