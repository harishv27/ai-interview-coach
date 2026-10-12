// Privacy by design: contact details are never needed to coach an answer, so strip them before
// anything is sent to the model or written to logs.
// Every quantifier is bounded and the alternatives don't overlap, so matching stays linear even on hostile input
// (the earlier phone pattern was quadratic on long runs of digits and separators).
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}/gi;
const PHONE = /[+(]?\d[\d\s().-]{7,18}\d/g; // a run of 9–20 phone-like characters; digit count is checked below
const URLS = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github|gitlab)\.com\/\S+/gi;

export function redactPII(text) {
  if (typeof text !== 'string') return text;
  return text.replace(EMAIL, '[email]').replace(URLS, '[link]').replace(PHONE, (m) => { const n = m.replace(/\D/g, '').length; return n >= 9 && n <= 15 ? '[phone]' : m; });
}

// Deep-redact any JSON-able value (used for log lines).
export function redactDeep(v) {
  if (typeof v === 'string') return redactPII(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}
