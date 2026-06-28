/**
 * AI integration layer.
 * Uses the Anthropic Claude API when VITE_ANTHROPIC_API_KEY is set.
 * Falls back to demo responses when no key is available.
 */

import { DEMO_AI_RESPONSE, DEMO_SHOPPING_LIST_RESPONSE, DEMO_NUTRITION_PLAN_RESPONSE, DEMO_RECEIPT_TEXT } from '@/lib/demoData';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';

export const IS_DEMO_MODE = !API_KEY;

async function callClaude(prompt, systemPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt || 'You are a helpful assistant. Always respond with valid JSON only — no markdown, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Calls Claude API with a prompt and JSON schema.
 * Falls back to demo data when no API key is configured.
 */
export async function invokeLLM({ prompt, response_json_schema }) {
  if (!API_KEY) {
    return buildDemoResponse(prompt);
  }

  const schemaStr = JSON.stringify(response_json_schema, null, 2);
  const fullPrompt = `${prompt}\n\nRespond with valid JSON matching this schema:\n${schemaStr}`;
  return callClaude(fullPrompt);
}

function buildDemoResponse(prompt) {
  const lower = prompt.toLowerCase();
  // Meal plan MUST be checked first — its prompt contains "shopping list" as context,
  // so checking shopping list first incorrectly returns the shopping list demo response.
  if (lower.includes('meal plan') || lower.includes('nutrition plan') || lower.includes('breakfast') || lower.includes('lunch')) {
    return Promise.resolve(DEMO_NUTRITION_PLAN_RESPONSE);
  }
  // Shopping list prompt contains "RECEIPT ITEMS" — check before generic receipt
  if (lower.includes('shopping list') || lower.includes('סל קניות') || lower.includes('shopping_period')) {
    return Promise.resolve(DEMO_SHOPPING_LIST_RESPONSE);
  }
  if (lower.includes('receipt') || lower.includes('קבלה') || lower.includes('supermarket')) {
    return Promise.resolve(DEMO_AI_RESPONSE);
  }
  return Promise.resolve({});
}

/**
 * Accepts a File object and returns a local object URL for further processing.
 */
export async function uploadFile({ file }) {
  const url = URL.createObjectURL(file);
  return { file_url: url };
}

/**
 * Extracts structured data from a file URL using Claude Vision.
 * Falls back to demo receipt text when no API key is configured.
 */
export async function extractDataFromFile({ file_url, json_schema }) {
  if (!API_KEY) {
    return { output: { receipt_text: DEMO_RECEIPT_TEXT } };
  }

  // Fetch blob and convert to base64 for Claude Vision
  const resp = await fetch(file_url);
  const blob = await resp.blob();
  const base64 = await blobToBase64(blob);
  const mediaType = blob.type || 'image/jpeg';

  const schemaStr = JSON.stringify(json_schema, null, 2);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: 'You are an OCR assistant. Extract text from receipts and respond with valid JSON only.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `Extract the receipt text and respond with JSON matching: ${schemaStr}` },
        ],
      }],
    }),
  });

  if (!response.ok) throw new Error('Vision extraction failed');
  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return { output: JSON.parse(cleaned) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
