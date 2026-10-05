// Fixture candidate + job for the engineering evaluation set (eng-v1).
export const SET = 'eng-v1';
export const ROLE = 'AI Engineer';
export const RESUME = `Alex Rivera — AI Engineer (3 years)
Acme AI, AI Engineer, 2023–present
- Built a retrieval-augmented support assistant (Python, FastAPI, LangChain, pgvector) serving about 2,000 queries a day.
- Created a 300-question evaluation set and added reranking; hallucination rate fell from 18% to 6%.
- Cut p95 latency from 2.8s to 1.1s with response caching and streaming.
- Deployed on AWS ECS with GitHub Actions CI/CD; mentored 2 interns.
Beta Labs, Backend Engineer, 2021–2023
- Migrated cron jobs to Celery with retries and idempotency keys; job failures fell by 70%.
- Tuned Postgres queries and indexes behind the billing API.
Skills: Python, FastAPI, Postgres, Redis, Docker, AWS, LangChain, evaluation, observability.`;
export const JD = `AI Engineer — Northwind
Build and ship LLM-powered features. You will design retrieval pipelines, build evaluation harnesses, own services in production on AWS, monitor quality and cost, and work closely with product and design.
Requirements: 2+ years of Python backend experience, hands-on RAG or LLM application experience, strong testing and evaluation habits, experience operating production services, clear communication.`;
