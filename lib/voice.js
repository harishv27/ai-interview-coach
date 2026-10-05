// Speech I/O for the live voice interview: Groq Whisper for listening, Groq Orpheus for speaking.
// Orpheus requires the Groq org admin to accept its terms once; until then synthesize() throws
// TtsUnavailable and the browser falls back to its built-in voice, so the interview still works.
import { QuotaError } from './llm.js';

const BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = () => process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
const TTS_MODEL = () => process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const TTS_VOICE = () => process.env.GROQ_TTS_VOICE || 'hannah';
const mock = () => process.env.LLM_MOCK === '1';
const auth = () => ({ Authorization: `Bearer ${process.env.GROQ_API_KEY}` });

export class TtsUnavailable extends Error {
  constructor(reason, message) { super(message || `Text-to-speech unavailable: ${reason}`); this.code = 'TTS_UNAVAILABLE'; this.reason = reason; }
}

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
// Whisper tends to invent these on silence or background noise
const HALLUCINATIONS = /^(thank you\.?|thanks\.?|thanks for watching\.?|thank you for watching\.?|you\.?|bye\.?|\.+)$/i;

/** Transcribe one recorded answer. Returns { text, duration }; text is '' when no real speech was found. */
export async function transcribe(buffer, mime, prompt = '') {
  if (mock()) return { text: 'This is a mock transcript of my answer about caching and latency.', duration: 5 };
  const type = (mime || '').split(';')[0].trim().toLowerCase() || 'audio/webm';
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type }), `answer.${EXT[type] || 'webm'}`);
  fd.append('model', STT_MODEL());
  fd.append('response_format', 'verbose_json');
  fd.append('language', 'en');
  fd.append('temperature', '0');
  if (prompt) fd.append('prompt', prompt.slice(0, 600)); // vocabulary hint: fixes "Readees" -> "Redis"
  const r = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: auth(), body: fd, signal: AbortSignal.timeout(45000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 429) throw new QuotaError('Speech-to-text limit reached', +r.headers.get('retry-after') || 60);
    throw new Error(j.error?.message || `Transcription failed (${r.status})`);
  }
  const segs = j.segments || [];
  const speechy = segs.length ? segs.some((s) => s.no_speech_prob < 0.6) : true;
  let text = (j.text || '').trim();
  if (!speechy || HALLUCINATIONS.test(text)) text = '';
  return { text, duration: j.duration };
}

const silentWav = (ms = 150) => {
  const n = Math.round((16000 * ms) / 1000) * 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
};

let status = { value: null, at: 0 };

/** Speak one short chunk of text. Returns a WAV buffer. */
export async function synthesize(text) {
  if (mock()) { status = { value: { tts: 'orpheus' }, at: Date.now() }; return silentWav(); }
  const r = await fetch(`${BASE}/audio/speech`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model: TTS_MODEL(), input: text, voice: TTS_VOICE(), response_format: 'wav' }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || '';
    if (j.error?.code === 'model_terms_required' || /terms/i.test(msg)) { status = { value: { tts: 'browser', reason: 'terms' }, at: Date.now() }; throw new TtsUnavailable('terms', msg); }
    if (r.status === 429) throw new TtsUnavailable('rate_limit', msg);
    throw new TtsUnavailable('error', msg || `Speech synthesis failed (${r.status})`);
  }
  status = { value: { tts: 'orpheus' }, at: Date.now() };
  return Buffer.from(await r.arrayBuffer());
}

/** Which voice the browser should use: 'orpheus' (natural) or 'browser' (built-in fallback). Cached for 10 minutes. */
export async function ttsStatus() {
  if (status.value && Date.now() - status.at < 10 * 60 * 1000) return status.value;
  try { await synthesize('Ready.'); } catch (e) { if (!(e instanceof TtsUnavailable)) status = { value: { tts: 'browser', reason: 'error' }, at: Date.now() }; else if (!status.value) status = { value: { tts: 'browser', reason: e.reason }, at: Date.now() }; }
  return status.value || { tts: 'browser', reason: 'unknown' };
}
