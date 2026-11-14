// Merchant name normalization (TZ §7.2).
// Known brands map to a clean name; everything else goes through generic noise stripping + Title Case.
// Different providers are never merged: only an explicit brand rule maps several raw strings to one name.

const BRANDS: [RegExp, string][] = [
  // Order matters: more specific first.
  [/\bPLANET\s*FITNESS\b/, 'Planet Fitness'],
  [/\bLA\s*FITNESS\b/, 'LA Fitness'],
  [/\bANYTIME\s*FITNESS\b/, 'Anytime Fitness'],
  [/\bYMCA\b/, 'YMCA'],
  [/\bNETFLIX\b/, 'Netflix'],
  [/\bSPOTIFY\b/, 'Spotify'],
  [/\bHULU\b/, 'Hulu'],
  [/\bDISNEY\s*(PLUS|\+)|\bDISNEYPLUS\b/, 'Disney+'],
  [/\bHBO\s*MAX\b|\bHBOMAX\b/, 'HBO Max'],
  [/\bPARAMOUNT\s*(\+|PLUS)/, 'Paramount+'],
  [/\bPEACOCK\b/, 'Peacock'],
  [/\bYOUTUBE\b/, 'YouTube'],
  [/\bAMAZON\s*PRIME\b|\bPRIME\s*VIDEO\b|\bAMZN\s*PRIME\b/, 'Amazon Prime'],
  [/\bAPPLE\s*MUSIC\b/, 'Apple Music'],
  [/\bICLOUD\b/, 'iCloud'],
  [/\bGOOGLE\s*\*?\s*ONE\b/, 'Google One'],
  [/\bDROPBOX\b/, 'Dropbox'],
  [/\bADOBE\b/, 'Adobe'],
  [/\bMICROSOFT\b|\bMSFT\b/, 'Microsoft'],
  [/\bCOMCAST\b|\bXFINITY\b/, 'Comcast'],
  [/\bSPECTRUM\b/, 'Spectrum'],
  [/\bVERIZON\b/, 'Verizon'],
  [/\bAT\s*&\s*T\b|\bATT\s*\*/, 'AT&T'],
  [/\bT-?MOBILE\b/, 'T-Mobile'],
  [/\bAAA\b/, 'AAA'],
  [/\bWHOLE\s*FOODS\b|\bWHOLEFDS\b|\bWFM\b/, 'Whole Foods'],
  [/\bTRADER\s*JOE'?S?\b/, "Trader Joe's"],
  [/\bKROGER\b/, 'Kroger'],
  [/\bWALMART\b|\bWAL-?MART\b/, 'Walmart'],
  [/\bSAFEWAY\b/, 'Safeway'],
  [/\bCOSTCO\b/, 'Costco'],
  [/\bTARGET\b/, 'Target'],
  [/\bSTARBUCKS\b/, 'Starbucks'],
  [/\bMCDONALD'?S?\b/, "McDonald's"],
  [/\bCHIPOTLE\b/, 'Chipotle'],
];

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  ),
);

const NOISE_WORDS = new Set([
  'COM', 'NET', 'ORG', 'USA', 'US', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'BILL', 'PAYMENT', 'PMT',
  'PURCHASE', 'POS', 'DEBIT', 'CARD', 'RECURRING', 'AUTOPAY', 'ONLINE', 'WWW', 'HTTPS', 'HTTP',
  'REFUND', 'RETURN', 'CREDIT', 'REVERSAL', 'SQ', 'TST', 'PP', 'PAYPAL',
]);

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "NETFLIX.COM 8844" -> "Netflix". */
export function normalizeMerchant(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!upper) return '';

  for (const [re, name] of BRANDS) {
    if (re.test(upper)) return name;
  }

  const cleaned = upper
    .replace(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/g, ' ') // phone numbers
    .replace(/\b\d{3}[-. ]\d{4}\b/g, ' ')
    .replace(/#\s*\w+/g, ' ') // store codes
    .replace(/\.(COM|NET|ORG|IO|TV|CO)\b/g, ' ')
    .replace(/[^A-Z0-9&'\s]/g, ' ');

  let tokens = cleaned.split(' ').filter(Boolean);
  tokens = tokens.filter((t) => !/\d/.test(t) && !NOISE_WORDS.has(t));
  if (tokens.length > 1 && US_STATES.has(tokens[tokens.length - 1])) tokens.pop();

  if (tokens.length === 0) {
    // Nothing meaningful left: fall back to a lightly cleaned version of the raw text.
    return raw
      .trim()
      .split(/\s+/)
      .map(titleCase)
      .join(' ');
  }
  return tokens.map(titleCase).join(' ');
}
