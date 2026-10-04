// Single source of truth for "what is a good answer". Used by the coach prompt,
// the eval harness, and rendered in the UI so candidates see the same standard.
export const CRITERIA = [
  {
    key: 'relevance',
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
      `- ${c.key} (${c.label}): ${c.question}\n    1 = ${c.anchors[1]}\n    3 = ${c.anchors[3]}\n    5 = ${c.anchors[5]}`
  ).join('\n');
}

export const overall = (scores) => {
  const v = CRITERIA_KEYS.map((k) => scores[k]).filter((n) => Number.isFinite(n));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
