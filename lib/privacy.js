// Privacy by design: contact details are never needed to coach an answer, so strip them before
// anything is sent to the model or written to logs.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)/g;
const URLS = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github|gitlab)\.com\/\S+/gi;

export function redactPII(text) {
  if (typeof text !== 'string') return text;
  return text.replace(EMAIL, '[email]').replace(URLS, '[link]').replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m));
}

// Deep-redact any JSON-able value (used for log lines).
export function redactDeep(v) {
  if (typeof v === 'string') return redactPII(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}
