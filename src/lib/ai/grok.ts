// xAI Grok client (OpenAI-compatible chat completions). Server-side only.
// Only the fields of ActionRequest are ever sent to the model (TZ §10.1, §11.2), with the merchant reduced to a
// safe canonical name (see safe-request.ts). Nothing is logged.
import { formatUsd } from '@/lib/format';
import { validateModelAnswer } from '@/lib/ai/response-check';
import { sanitizeActionRequest } from '@/lib/ai/safe-request';
import type { ActionRequest, ActionResponse } from '@/lib/types';

const XAI_URL = 'https://api.x.ai/v1/chat/completions';
/** Fast Grok 4.1 model with structured-output support; override with XAI_MODEL. */
export const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';
export const TIMEOUT_MS = 8000;

// JSON Schema for ActionResponse minus `source`. Unknown values are empty strings (mapped to null
// locally); xAI rejects minLength/maxLength/minItems/maxItems, so limits are enforced by Zod afterwards.
const RESPONSE_JSON_SCHEMA = {
  name: 'action_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'body', 'callScript', 'steps', 'limitations'],
    properties: {
      subject: { type: 'string', description: 'Email subject for cancellations; empty string otherwise.' },
      body: { type: 'string', description: 'Email body for cancellations; empty string otherwise.' },
      callScript: { type: 'string', description: 'Phone/chat script for negotiations; empty string otherwise.' },
      steps: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

export const SYSTEM_PROMPT = `You write short, practical texts that help a US family cancel or renegotiate a recurring bill. Write in English (US).

Output JSON only, matching the schema. Use an empty string for any text field that does not apply.

Rules:
- action "cut": write a cancellation email. "subject" and "body" are required. Ask the provider to confirm the effective cancellation date and any remaining charges. You may politely ask whether a prorated refund is possible, but never state or imply the customer is entitled to one. Put 2-4 short instructions for using the provider's support chat or contacting support in "steps". Leave "callScript" empty.
- action "negotiate": write a "callScript" of 3 to 6 short lines the customer can say on a call or in chat, including a request to confirm all fees, contract terms and the new price before agreeing. Leave "subject" and "body" empty. Put 3 short steps in "steps". If a target price is given, ask for it; if no target price is given, do NOT mention any specific savings amount or target.
- Always refer to the service by the exact merchant name given. Never write [Service] when a merchant name is provided.
- In "callScript", put each line the customer says on its own line (separated by a newline), 3 to 6 lines.
- Use placeholders for unknown details, exactly: [Account email], [Billing date], [Customer service channel]. Sign emails with [Your name], never with a placeholder for an email address.
- Never invent phone numbers, URLs, email addresses, competitor offers or prices, contract terms, or legal rights to a refund.
- Tone "polite": courteous and collaborative. Tone "firm": direct and businesslike, still respectful, no threats or insults.
- "limitations": 1-3 short honest notes, always including that the customer must contact the provider themselves and that results are not guaranteed.
- Do not do any math with money other than repeating the given amounts.
- Never mention JSON field names (subject, body, callScript, steps, limitations) in any generated text; write for humans instead (e.g., "Read the lines below").`;

function userPrompt(req: ActionRequest): string {
  const lines = [
    `merchant: ${req.merchant}`,
    `action: ${req.action}`,
    `billing frequency: ${req.frequency}`,
    `current price: ${formatUsd(req.currentPriceCents)} per billing period`,
    req.targetPriceCents !== undefined
      ? `target price: ${formatUsd(req.targetPriceCents)} per billing period`
      : 'target price: none given',
    `tone: ${req.tone}`,
  ];
  return lines.join('\n');
}

/** Parse + validate model output (see response-check.ts); returns null if unusable. */
export function parseModelOutput(content: unknown, req: ActionRequest): ActionResponse | null {
  if (typeof content !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  return validateModelAnswer(raw, req);
}

async function callOnce(
  req: ActionRequest,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<ActionResponse | null> {
  const res = await fetch(XAI_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(req) },
      ],
      response_format: { type: 'json_schema', json_schema: RESPONSE_JSON_SCHEMA },
    }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  return parseModelOutput(data.choices?.[0]?.message?.content, req);
}

/**
 * Ask Grok for an action text. Returns null on any failure (no key, HTTP error, timeout, invalid
 * output after one retry) so the caller can use the local fallback.
 */
export async function generateWithGrok(input: ActionRequest): Promise<ActionResponse | null> {
  // Last line of defence before the network: whatever the caller passed, the model only sees the safe merchant
  // name (allowlist or "Service provider"). The original value is not kept, retried, or logged.
  const req = sanitizeActionRequest(input);
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.XAI_MODEL?.trim() || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await callOnce(req, apiKey, model, controller.signal);
      if (out) return out;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
