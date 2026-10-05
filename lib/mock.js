// Deterministic stand-in for the model, used ONLY when LLM_MOCK=1 (API tests, offline UI work).
export function mockResponse(name, user) {
  switch (name) {
    case 'plan':
      return {
        questions: [
          { question: 'Walk me through your background.', type: 'opener', why_asked: 'Warm-up' },
          { question: 'Tell me about a time you used data to decide.', type: 'behavioural', why_asked: 'JD: data-driven' },
          { question: 'How would you prioritise a backlog?', type: 'situational', why_asked: 'JD: prioritisation' },
        ],
        gaps: ['No people-management evidence'],
      };
    case 'evaluate': {
      const m = user.match(/<candidate_answer>([\s\S]*?)<\/candidate_answer>/);
      const quote = (m?.[1] || '').trim().split(/\s+/).slice(0, 6).join(' ');
      return {
        scores: { relevance: 4, structure: 3, specificity: 3, impact: 2, clarity: 4 },
        strengths: [{ criterion: 'relevance', quote, comment: 'On topic.' }],
        gaps: [{ criterion: 'impact', quote: 'a quote that is not in the answer', comment: 'No result.' }],
        technical_claims_to_verify: [], resume_conflicts: [], confidence: 'medium',
        summary: 'Mock evaluation.', follow_up: 'What was the result?',
      };
    }
    case 'rewrite':
      return { facts: [{ fact: 'mock fact', source: 'answer' }], rewrite: 'I did the work and the outcome was [X%] better.' };
    case 'audit':
      return { unsupported_claims: [], clean_rewrite: '' };
    case 'turn':
      return { ack: 'Thanks, that makes sense.', follow_up: 'What was the measurable result?', move_on: false };
    case 'summary':
      return { headline: 'Mock debrief', top_strengths: ['Clear'], top_priorities: ['Add metrics'], practice_plan: 'Practise.' };
    default:
      return {};
  }
}
