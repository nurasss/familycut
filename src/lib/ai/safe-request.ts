// Privacy policy for what the language model may see about a service (TZ §10.1, §11.3, NFR-04).
// Browser-safe: pure functions, no env, no server imports. The same policy runs on the server right
// before the model call (grok.ts), so a direct POST or an old client cannot bypass it.
//
// The model never receives a free-text name. The merchant is chosen from an explicit allowlist of canonical
// service names; anything else — including any result of normalizeMerchant that is not on the list — becomes
// the fixed "Service provider". Personal names, emails, phone/account numbers or injected text cannot be
// reliably recognised by pattern, so the policy never tries to "clean" a string: it either recognises the
// whole name as a known service or replaces it.
import type { ActionRequest, ActionTone, Expense } from '@/lib/types';

export const SAFE_MERCHANT_FALLBACK = 'Service provider';

/** Canonical names the model is allowed to see. Output of safeMerchantForAi is always one of these or the fallback. */
export const ALLOWED_MERCHANTS: readonly string[] = [
  // Streaming, media, news
  'Netflix', 'Spotify', 'Hulu', 'Disney+', 'HBO Max', 'Paramount+', 'Peacock', 'YouTube', 'YouTube Premium',
  'YouTube Music', 'YouTube TV', 'Amazon Prime', 'Apple Music', 'Apple', 'Audible', 'SiriusXM',
  'New York Times', 'Max', 'Crunchyroll', 'Pandora', 'Tidal', 'Twitch',
  // Software and cloud
  'iCloud', 'Google One', 'Dropbox', 'Adobe', 'Adobe Photoshop', 'Adobe Acrobat', 'Adobe Lightroom',
  'Adobe Illustrator', 'Adobe Premiere', 'Adobe InDesign', 'Adobe Creative Cloud', 'Microsoft 365', 'Microsoft',
  'ChatGPT', 'Notion', 'Slack', 'Zoom', 'Canva', 'Evernote', 'LastPass', '1Password', 'NordVPN', 'ExpressVPN',
  'Duolingo', 'Xbox Game Pass', 'PlayStation Plus', 'Nintendo Switch Online',
  // Telecom and utilities
  'Xfinity', 'Comcast', 'Spectrum', 'Verizon', 'AT&T', 'T-Mobile', 'ADT',
  // Fitness and memberships
  'Planet Fitness', 'LA Fitness', 'Anytime Fitness', 'YMCA', 'Peloton', 'AAA',
  // Stores and food (known names only)
  'Whole Foods', "Trader Joe's", 'Kroger', 'Walmart', 'Safeway', 'Costco', 'Target', 'Starbucks', "McDonald's",
  'Chipotle',
  // Generic labels used by the built-in sample data (synthetic, fixed)
  'Streaming A', 'Fitness membership', 'Internet Provider', 'Music family plan', 'Cloud storage',
];

/** Extra spellings that map to a canonical name. Whole-string match only. */
const ALIASES: Record<string, string> = {
  'disney plus': 'Disney+',
  'hbo max': 'HBO Max',
  'paramount plus': 'Paramount+',
  'amazon prime video': 'Amazon Prime',
  'prime video': 'Amazon Prime',
  'apple tv': 'Apple',
  'apple tv+': 'Apple',
  'nyt': 'New York Times',
  'the new york times': 'New York Times',
  'microsoft office': 'Microsoft 365',
  'office 365': 'Microsoft 365',
  'sirius xm': 'SiriusXM',
  'att': 'AT&T',
  'tmobile': 'T-Mobile',
  'creative cloud': 'Adobe Creative Cloud',
  'google youtube': 'YouTube',
};

/** Case, punctuation and spacing insensitive key; keeps + and & because they distinguish names. */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9+&]+/g, ' ')
    .trim();
}

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const name of ALLOWED_MERCHANTS) m.set(fold(name), name);
  for (const [alias, name] of Object.entries(ALIASES)) m.set(fold(alias), name);
  return m;
})();

/**
 * Canonical name for the model: a known service recognised from the WHOLE string (ignoring case, punctuation
 * and a trailing ".com"), else "Service provider". Never returns any part of the input.
 */
export function safeMerchantForAi(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 80) return SAFE_MERCHANT_FALLBACK;
  const key = fold(raw).replace(/ com$/, '');
  return LOOKUP.get(key) ?? SAFE_MERCHANT_FALLBACK;
}

/** Same request with the merchant replaced by its safe value. All other fields are rebuilt, nothing else is copied. */
export function sanitizeActionRequest(req: ActionRequest): ActionRequest {
  const out: ActionRequest = {
    merchant: safeMerchantForAi(req.merchant),
    action: req.action,
    frequency: req.frequency,
    currentPriceCents: req.currentPriceCents,
    tone: req.tone,
  };
  if (req.targetPriceCents !== undefined) out.targetPriceCents = req.targetPriceCents;
  return out;
}

/**
 * Request body for POST /api/ai/action built from a local expense. Contains only ActionRequest fields:
 * no notes, reasons, transaction IDs or raw descriptions. The original merchant stays in the local expense
 * for display. Cut → "cut"; every other decision → "negotiate" (current UI behaviour). The target price is
 * only sent for negotiation. Does not mutate `expense`.
 */
export function buildSafeActionRequest(expense: Expense, tone: ActionTone): ActionRequest {
  const action = expense.decision === 'cut' ? 'cut' : 'negotiate';
  const req: ActionRequest = {
    merchant: safeMerchantForAi(expense.merchant),
    action,
    frequency: expense.frequency,
    currentPriceCents: expense.priceCents,
    tone,
  };
  if (action === 'negotiate' && expense.targetPriceCents !== undefined) {
    req.targetPriceCents = expense.targetPriceCents;
  }
  return req;
}
