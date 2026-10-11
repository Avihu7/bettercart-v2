/**
 * Receipt-reading client.
 *
 * The browser never talks to the AI provider and never holds its API key: it
 * asks the BetterCart server (server/ai.js), which calls the Anthropic API
 * with the server-side ANTHROPIC_API_KEY. When the server has no key, receipt
 * reading falls back to demo responses.
 */

import { DEMO_AI_RESPONSE, DEMO_RECEIPT_TEXT } from '@/lib/demoData';
import { UNAUTHORIZED_EVENT } from '@/lib/serverDB';

const BASE_URL = import.meta.env.VITE_API_URL || '';
const MAX_FILE_BYTES = 7 * 1024 * 1024;

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    // { error, code } from server/ai.js — the upload page has a message per code
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Receipt reading failed (${res.status})`);
    error.code = body.code || 'unknown';
    error.status = res.status;
    throw error;
  }
  return res.json();
}

let configured = null;
/** Is real receipt reading available on the server? (false → demo mode). Cached once answered. */
export function aiConfigured() {
  if (!configured) {
    configured = request('/api/ai/status').then(s => !!s.configured).catch(err => {
      configured = null; // ask again next time
      throw err;
    });
  }
  return configured;
}

/**
 * Parses the JSON in a model answer. Code fences are stripped; when the model
 * adds a note after the JSON (or before it), only the first complete JSON
 * object/array is taken — found by bracket balancing that respects strings.
 * Anything that is still not valid JSON throws, as before.
 */
export function parseJsonAnswer(text) {
  const cleaned = String(text || '{}').replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.search(/[{[]/);
    if (start === -1) throw err;
    let depth = 0;
    let inString = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          console.warn(`[receipt AI] ignored ${cleaned.length - i - 1} characters after the JSON answer`);
          return JSON.parse(cleaned.slice(start, i + 1));
        }
      }
    }
    throw err;
  }
}

/**
 * Reads a receipt's text: { store_name, purchase_date, total_amount, items }.
 * Only receipts use AI (the basket and the weekly menu are rule-based).
 * Falls back to demo data when the server has no API key.
 */
export async function readReceiptText(receiptText) {
  if (!(await aiConfigured())) return DEMO_AI_RESPONSE;
  const { text } = await request('/api/ai/receipt-text', {
    method: 'POST',
    body: JSON.stringify({ receipt_text: receiptText }),
  });
  return parseJsonAnswer(text);
}

/**
 * Accepts a File object and returns a local object URL for further processing.
 */
export async function uploadFile({ file }) {
  const url = URL.createObjectURL(file);
  return { file_url: url };
}

/**
 * Transcribes an uploaded receipt (image or PDF): { output: { receipt_text } }.
 * Falls back to demo receipt text when the server has no API key.
 */
export async function extractDataFromFile({ file_url }) {
  if (!(await aiConfigured())) {
    return { output: { receipt_text: DEMO_RECEIPT_TEXT } };
  }
  const blob = await (await fetch(file_url)).blob();
  // base64 adds a third; the server accepts request bodies up to 10 MB
  if (blob.size > MAX_FILE_BYTES) {
    const error = new Error('הקובץ גדול מדי');
    error.code = 'too_large';
    throw error;
  }
  const { text } = await request('/api/ai/receipt-file', {
    method: 'POST',
    body: JSON.stringify({ media_type: blob.type, data: await blobToBase64(blob) }),
  });
  return { output: parseJsonAnswer(text) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
