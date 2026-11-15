// Strict validation of what the model returned (TZ §10.1–10.3). Server side. The model output is untrusted:
// the structure is checked BEFORE any normalisation, so a malformed answer triggers the retry / local fallback
// instead of being "repaired" into something that looks valid.
//
// What this does NOT do: it cannot prove that a text is legally correct or free of every invented claim. It checks the
// structure, the required content for the action, the number of script lines, dollar amounts against the request,
// and rejects text that contains URLs, e-mail addresses or phone numbers (the prompt forbids inventing them and we
// have no verified contact data to allow any).
import { actionResponseSchema } from '@/lib/schemas';
import type { ActionRequest, ActionResponse } from '@/lib/types';

const MIN_SCRIPT_LINES = 3;
const MAX_SCRIPT_LINES = 6;
const MAX_STEPS = 6;
const MAX_LIMITATIONS = 5;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Dollar amounts such as "$75", "$1,234.56" -> cents. Removed from the text before the phone scan. */
const MONEY = /\$\s?\d[\d,]*(?:\.\d{1,2})?(?![\d])/g;

function moneyToCents(token: string): number {
  const [whole, frac = ''] = token.replace(/[$,\s]/g, '').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

// The only bracketed text that is not scanned: the placeholders the prompt asks for. Any other bracket content is
// scanned like normal text, so "[https://evil.com]" or "[1-800-555-0100]" cannot hide a contact.
const ALLOWED_PLACEHOLDERS = /\[(?:Account email|Billing date|Customer service channel|Your name)\]/gi;

// Top-level domains that are never ordinary words. Two-letter country codes that are also English words (it, in, no,
// me, to, us, is, at, ...) are deliberately left out of the "bare domain" rule, so a missing space after a full stop
// ("bill.It") is not mistaken for a site; they are still caught with a scheme, "www.", a path or three dotted labels.
const TLD =
  'com|net|org|info|biz|edu|gov|mil|int|io|app|dev|ai|tv|xyz|online|site|store|shop|tech|cloud|link|click|top|club|vip|live|pro|help|support|' +
  'uk|ru|de|fr|es|nl|ca|au|jp|cn|br|mx|eu|ch|se|pl|tr|ua|kz|ly|cc|ws';
const URL_LIKE = [
  /\bhttps?:\/\//i,
  /\bwww\./i,
  // two labels and a known TLD: example.xyz, netflix.com
  new RegExp(`\\b[a-z0-9][a-z0-9-]*\\.(?:${TLD})\\b`, 'i'),
  // any domain with a path: example.ru/help, shop.example.it/cancel
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\/\S/i,
  // three or more labels ending in letters: support.example.co.uk (not a dotted date such as 12.10.2026)
  /\b[a-z0-9][a-z0-9-]+(?:\.[a-z0-9][a-z0-9-]+)+\.[a-z]{2,24}\b/i,
];
const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
// 555-123-4567, (555) 123-4567, +1 555 123 4567, 1-800-555-0100, 1-800-FLOWERS, and any run of 10+ digits.
const PHONE_LIKE = [
  /(?:\+?\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
  /\b1[\s.-]?8\d\d[\s.-]?[a-z0-9]{3,}[\s.-]?[a-z0-9]{0,4}\b/i,
  /\b\d{3}[\s.-]\d{4}\b/,
  /\d(?:[\s.-]?\d){9,}/,
];

/**
 * True if the text looks like it contains a URL, domain, e-mail address or phone number. Dollar amounts, dates and the
 * four agreed [placeholders] are not contacts. This is a heuristic filter, not a guarantee: obfuscated forms
 * ("support at example dot com", spelled-out numbers, unusual separators) are not detected.
 */
export function containsUnverifiedContact(text: string): boolean {
  const scanned = text.replace(MONEY, ' ').replace(ALLOWED_PLACEHOLDERS, ' ');
  return URL_LIKE.some((re) => re.test(scanned)) || EMAIL_LIKE.test(scanned) || PHONE_LIKE.some((re) => re.test(scanned));
}

/** Every dollar amount must be the current or the target price from the request: no invented prices or savings. */
function amountsAllowed(text: string, req: ActionRequest): boolean {
  const allowed = new Set<number>([req.currentPriceCents]);
  if (req.targetPriceCents !== undefined) allowed.add(req.targetPriceCents);
  return (text.match(MONEY) ?? []).every((m) => allowed.has(moneyToCents(m)));
}

/**
 * Validate the parsed JSON of a model answer for this request. Returns the ActionResponse (source "ai") or null.
 * Any structural problem (wrong type, missing key, steps=42, limitations="invalid", too long, empty useful content,
 * unverified contact, foreign price) returns null so the caller retries once and then falls back.
 */
export function validateModelAnswer(raw: unknown, req: ActionRequest): ActionResponse | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  // 1) Structure exactly as the schema we asked for. Nothing is coerced.
  if (typeof r.subject !== 'string' || typeof r.body !== 'string' || typeof r.callScript !== 'string') return null;
  if (!isStringArray(r.steps) || !isStringArray(r.limitations)) return null;

  const subject = r.subject.trim();
  const body = r.body.trim();
  const callScript = r.callScript.trim();
  const steps = r.steps.map((s) => s.trim());
  const limitations = r.limitations.map((s) => s.trim());

  // 2) Required content for the action; fields that do not belong to it must be empty strings.
  if (req.action === 'cut') {
    if (!body || callScript) return null;
  } else {
    if (!callScript || subject || body) return null;
    const lines = callScript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < MIN_SCRIPT_LINES || lines.length > MAX_SCRIPT_LINES) return null;
  }

  // 3) Useful, bounded steps and limitations; no blank entries.
  if (steps.length < 1 || steps.length > MAX_STEPS || steps.some((s) => s === '')) return null;
  if (limitations.length < 1 || limitations.length > MAX_LIMITATIONS || limitations.some((s) => s === '')) return null;

  // 4) Content safety: no contacts, no prices other than the ones we gave, no leaked placeholders or schema keys.
  const all = [subject, body, callScript, ...steps, ...limitations].join('\n');
  if (containsUnverifiedContact(all)) return null;
  if (!amountsAllowed(all, req)) return null;
  if (/\[service\]/i.test(all)) return null; // the prompt gives the merchant name; an unfilled placeholder is a bad answer
  if (/callscript/i.test(all)) return null; // never leak the JSON field name "callScript" into user-facing text

  // 5) Length limits of the public schema (also guards the sizes of every field).
  const parsed = actionResponseSchema.safeParse({
    subject: subject || null,
    body: body || null,
    callScript: callScript || null,
    steps,
    limitations,
    source: 'ai' as const,
  });
  return parsed.success ? parsed.data : null;
}
