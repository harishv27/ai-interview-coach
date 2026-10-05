// Single source of truth for "what is a good answer". Used by the coach prompt,
// the eval harness, and rendered in the UI so candidates see the same standard.
export const CRITERIA = [
  {
    key: 'relevance',
    rule: "Answering a different question than asked caps relevance at 2.",
    label: 'Relevance',
    question: 'Does it directly answer what was asked, for this role?',
    anchors: {
      1: 'Off-topic or answers a different question.',
      3: 'Partly addresses the question; drifts or stays generic.',
      5: 'Answers exactly what was asked and is tied to the target role.',
    },
  },
  {
    key: 'structure',
    rule: "5 requires all three: the situation, the candidate's OWN actions, and an explicit result. No result stated → max 3. No discernible order → max 2.",
    label: 'Structure',
    question: 'Is there a clear arc (e.g. situation → action → result)?',
    anchors: {
      1: 'Rambling; no discernible order.',
      3: 'Some order, but the result or the candidate\'s own role is missing.',
      5: 'Clear situation/task, specific actions, explicit outcome.',
    },
  },
  {
    key: 'specificity',
    rule: "Mostly 'we' with no stated personal contribution → max 3. 4+ requires concrete details (named tools, decisions, numbers) about what the candidate did.",
    label: 'Specificity',
    question: 'Concrete details: what you did, tools, decisions, numbers?',
    anchors: {
      1: 'Only generalities and buzzwords ("I\'m a team player").',
      3: 'One or two concrete details; mostly "we" and abstractions.',
      5: 'Concrete, checkable detail about the candidate\'s own actions.',
    },
  },
  {
    key: 'impact',
    rule: "For a story about the candidate's own past work: no quantified or measurable outcome → max 3; a vague outcome ('it went well', 'everyone was happy') → max 2; no outcome at all → 1; 5 requires a quantified result tied to a business goal and attributable to the candidate. For a conceptual or design question with no past project, do NOT score 1 for 'no outcome': judge whether the answer states consequences, trade-offs and how success would be measured — typically 2–3, and 4 only if it names concrete measures or thresholds.",
    label: 'Business impact',
    question: 'Does it show outcomes that matter (revenue, cost, time, users, risk)?',
    anchors: {
      1: 'No outcome stated.',
      3: 'Outcome stated qualitatively ("it went well").',
      5: 'Quantified or clearly-evidenced outcome tied to a business goal.',
    },
  },
  {
    key: 'clarity',
    rule: "Heavy filler, hedging or rambling → max 3. Reserve 5 for crisp, well-paced answers; most good answers are 4.",
    label: 'Clarity',
    question: 'Concise, easy to follow, appropriate length, no filler?',
    anchors: {
      1: 'Confusing or extremely padded/too thin to follow.',
      3: 'Understandable but wordy, hedging, or uneven.',
      5: 'Crisp, well-paced, easy to follow when spoken aloud.',
    },
  },
];

export const CRITERIA_KEYS = CRITERIA.map((c) => c.key);

export function rubricText() {
  return CRITERIA.map(
    (c) =>
      `- ${c.key} (${c.label}): ${c.question}\n    1 = ${c.anchors[1]}\n    3 = ${c.anchors[3]}\n    5 = ${c.anchors[5]}\n    HARD RULE: ${c.rule}`
  ).join('\n');
}

export const overall = (scores) => {
  const v = CRITERIA_KEYS.map((k) => scores[k]).filter((n) => Number.isFinite(n));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
