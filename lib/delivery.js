// Delivery coaching computed from the transcript + elapsed time. Text-only: this measures pace and
// filler words, NOT tone or prosody (that would need audio analysis).
const FILLERS = [
  ['um', /\b(?:um+|uh+|er|erm|hmm+)\b/gi],
  ['like', /\blike,/gi], // only the filler usage ("like, ..."), not "I like X"
  ['you know', /\byou know\b/gi],
  ['basically', /\bbasically\b/gi],
  ['actually', /\bactually\b/gi],
  ['sort of / kind of', /\b(?:sort|kind) of\b/gi],
  ['I mean', /\bi mean\b/gi],
  ['literally', /\bliterally\b/gi],
];

export function deliveryMetrics(answer, seconds, inputMode) {
  const words = (answer.trim().match(/\S+/g) || []).length;
  const counts = FILLERS.map(([label, re]) => [label, (answer.match(re) || []).length]).filter(([, n]) => n > 0);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const sentences = answer.split(/[.!?]+\s/).map((s) => (s.match(/\S+/g) || []).length);
  const out = {
    words,
    fillers: { total, per100: words ? +((total / words) * 100).toFixed(1) : 0, top: counts.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, n]) => ({ label, n })) },
    longestSentence: Math.max(0, ...sentences),
  };
  if (Number.isFinite(seconds) && seconds >= 10 && words >= 15) {
    out.seconds = Math.round(seconds);
    out.wpm = Math.round((words / seconds) * 60);
    out.pace = out.wpm < 100 ? 'slow' : out.wpm > 170 ? 'fast' : 'good';
    out.paceNote = inputMode === 'voice' ? 'Includes thinking pauses.' : 'Typed answers include typing time, so treat pace loosely.';
  }
  return out;
}
