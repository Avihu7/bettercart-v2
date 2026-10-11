/**
 * Receipt reading — the only AI in BetterCart, and the only place the
 * Anthropic API key is used. The key is a server setting (ANTHROPIC_API_KEY in
 * .env.local); it is never sent to the browser, logged or returned.
 *
 *   browser → POST /api/ai/receipt-file | /api/ai/receipt-text → Anthropic API
 *
 * Two fixed requests, nothing else (this is not a general proxy):
 *   transcribeReceipt  an uploaded image / PDF → the receipt's text, as printed
 *   readReceiptText    receipt text → store, date, total and product lines
 * Both return the answer as a JSON string; the client parses and classifies it
 * (src/lib/ai.js, src/lib/receiptPipeline.js). Without a key the client runs
 * in demo mode and never calls these.
 */
import { RECEIPT_READING_PROMPT, RECEIPT_RESPONSE_SCHEMA } from '../src/lib/receiptPrompt.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
// Receipt photos need careful, literal OCR (small print, Hebrew, thermal-paper
// fading) — a stronger model than the text-analysis MODEL reduces hallucinated
// items and misread prices.
const VISION_MODEL = 'claude-sonnet-5';

const ANSWER_TOOL = 'record_receipt';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PDF_TYPE = 'application/pdf';
export const SUPPORTED_MEDIA_TYPES = [...IMAGE_TYPES, PDF_TYPE];
// Longer than any supermarket receipt; keeps the route from being used for anything else
export const MAX_RECEIPT_TEXT = 20000;

const apiKey = () => process.env.ANTHROPIC_API_KEY || '';
export const isAiConfigured = () => !!apiKey();

/** An error the routes turn into { error, code } — never carries the key. */
export class AiError extends Error {
  constructor(message, code, status = 502) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

/** The content block for an uploaded receipt file: an image, or a PDF document. */
export function fileContentBlock(mediaType, data) {
  const source = { type: 'base64', media_type: mediaType, data };
  if (IMAGE_TYPES.has(mediaType)) return { type: 'image', source };
  if (mediaType === PDF_TYPE) return { type: 'document', source };
  throw new AiError('סוג הקובץ אינו נתמך. אפשר להעלות תמונה (JPG, PNG, WEBP, GIF) או PDF.', 'unsupported_media', 415);
}

// Anthropic error → a code the upload page has a message for (never 401 to the
// browser: that would read as an expired BetterCart session)
function upstreamError(status, bodyText, context) {
  let type = null, message = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    type = parsed?.error?.type || null;
    message = parsed?.error?.message || bodyText;
  } catch { /* body wasn't JSON */ }
  let code = 'unknown';
  if (status === 401) code = 'auth';
  else if (status === 400 && /credit balance/i.test(message)) code = 'billing';
  else if (status === 400 && /media_type|unsupported.*image|image.*format|pdf/i.test(message)) code = 'unsupported_media';
  else if (status === 413 || /too large|exceeds.*size/i.test(message)) code = 'too_large';
  else if (status === 429) code = 'rate_limit';
  console.error(`[receipt AI] context=${context} status=${status} type=${type} code=${code}`);
  return new AiError(message || `Claude API error ${status}`, code, code === 'too_large' ? 413 : code === 'unsupported_media' ? 415 : 502);
}

/**
 * One request to the model; the answer comes back as a JSON string of `schema`.
 * The model answers through a tool call it is required to make, with the schema
 * enforced by the API (strict), so the answer is a parsed object of exactly that
 * shape. Written as plain text, the model left the quote in Hebrew units
 * unescaped ("750 מ"ל", "1 ק"ג") — not valid JSON — and every receipt with such
 * a line failed to read; without strict it sometimes sent the list as one string.
 */
async function messages(body, schema, context) {
  if (!isAiConfigured()) throw new AiError('קריאת קבלות אינה מוגדרת בשרת', 'not_configured', 503);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      ...body,
      tools: [{ name: ANSWER_TOOL, description: 'Records what was read from the receipt.', strict: true, input_schema: schema }],
      tool_choice: { type: 'tool', name: ANSWER_TOOL },
    }),
  });
  if (!response.ok) throw upstreamError(response.status, await response.text(), context);
  const data = await response.json();
  if (data.stop_reason === 'max_tokens') {
    console.error(`[receipt AI] context=${context} response truncated at max_tokens`);
    throw new AiError('התשובה מה-AI נחתכה (יותר מדי תוכן) — נסו שוב עם קבלה קצרה יותר', 'truncated');
  }
  const answer = data.content?.find(block => block.type === 'tool_use' && block.name === ANSWER_TOOL)?.input;
  if (!answer || typeof answer !== 'object') {
    console.error(`[receipt AI] context=${context} no answer (stop_reason=${data.stop_reason})`);
    throw new AiError('Claude returned no answer', 'empty');
  }
  return JSON.stringify(answer);
}

/** Receipt text → the answer for RECEIPT_RESPONSE_SCHEMA, as a JSON string. */
export function readReceiptText(receiptText) {
  return messages({
    model: MODEL,
    max_tokens: 16000,
    system: 'You read supermarket receipts. Record exactly what is printed, nothing else.',
    messages: [{ role: 'user', content: `${RECEIPT_READING_PROMPT}${receiptText}` }],
  }, RECEIPT_RESPONSE_SCHEMA, 'readReceiptText');
}

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['receipt_text'],
  properties: {
    receipt_text: { type: 'string', description: 'Full text content of the receipt, preserving item names, prices, and totals' },
  },
};

/** An uploaded receipt (base64 image or PDF) → { receipt_text }, as a JSON string. */
export function transcribeReceipt(mediaType, data) {
  const file = fileContentBlock(mediaType, data);
  return messages({
    model: VISION_MODEL,
    // Thinking and text blocks share this budget; long receipts need headroom.
    max_tokens: 4096,
    system: [
      'You are a precise OCR assistant for Israeli supermarket receipts (Hebrew).',
      'Transcribe ONLY text that is clearly and unambiguously legible in the image.',
      'Never invent, guess, autocomplete, or hallucinate any item name, price, quantity, or number that is not clearly visible — it is much better to omit an unclear line entirely than to fabricate a plausible-looking one.',
      'Preserve exact Hebrew wording and exact numbers as printed, line by line (store name, date, each product line, and the total).',
    ].join(' '),
    messages: [{
      role: 'user',
      content: [
        file,
        { type: 'text', text: 'Transcribe this receipt exactly as shown.' },
      ],
    }],
  }, TRANSCRIPT_SCHEMA, 'transcribeReceipt');
}

/** Registers the receipt-AI routes (all behind requireAuth). Call before the /api/:entity routes. */
export function registerAiRoutes(app, requireAuth) {
  const fail = (res, err) => {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[receipt AI] request failed');
    res.status(502).json({ error: 'קריאת הקבלה נכשלה', code: 'unknown' });
  };

  // Is real receipt reading available? (false → the client runs in demo mode)
  app.get('/api/ai/status', requireAuth, (_req, res) => {
    res.json({ configured: isAiConfigured() });
  });

  app.post('/api/ai/receipt-text', requireAuth, async (req, res) => {
    const text = req.body?.receipt_text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'חסר טקסט קבלה', code: 'bad_request' });
    if (text.length > MAX_RECEIPT_TEXT) return res.status(413).json({ error: 'טקסט הקבלה ארוך מדי', code: 'too_large' });
    try {
      res.json({ text: await readReceiptText(text) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ai/receipt-file', requireAuth, async (req, res) => {
    const { media_type: mediaType, data } = req.body || {};
    if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'הקובץ ריק', code: 'bad_request' });
    try {
      res.json({ text: await transcribeReceipt(String(mediaType || ''), data) });
    } catch (err) { fail(res, err); }
  });
}
