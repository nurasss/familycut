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
  // YouTube products are billed separately; never merge them. A bare "GOOGLE *YOUTUBE" does not say which
  // product it is, so it stays plain "YouTube" instead of guessing.
  [/\bYOUTUBE\s*TV\b/, 'YouTube TV'],
  [/\bYOUTUBE\s*MUSIC\b/, 'YouTube Music'],
  [/\bYOUTUBE\s*PREMIUM\b|\bYOUTUBEPREMIUM\b/, 'YouTube Premium'],
  [/\bYOUTUBE\b|\bGOOGLE\s*\*?\s*YOUTUBE/, 'YouTube'],
  [/\bNYT\b|\bNY\s*TIMES\b|\bNEW\s*YORK\s*TIMES\b|\bNYTIMES\b/, 'New York Times'],
  [/\bPELOTON\b/, 'Peloton'],
  [/\bADT\b/, 'ADT'],
  [/\bAUDIBLE\b/, 'Audible'],
  [/\bSIRIUS\s*XM\b|\bSIRIUSXM\b/, 'SiriusXM'],
  [/\bAPPLE\.COM\/BILL\b|\bAPPLE\s*(SERVICES|ONE|TV\+?)\b|\bITUNES\b/, 'Apple'],
  [/\bAMAZON\s*PRIME\b|\bPRIME\s*VIDEO\b|\bAMZN\s*PRIME\b/, 'Amazon Prime'],
  [/\bAPPLE\s*MUSIC\b/, 'Apple Music'],
  [/\bICLOUD\b/, 'iCloud'],
  [/\bGOOGLE\s*\*?\s*ONE\b/, 'Google One'],
  [/\bDROPBOX\b/, 'Dropbox'],
  // Known Adobe products are separate services. Anything else from Adobe stays plain "Adobe".
  [/\bPHOTOSHOP\b/, 'Adobe Photoshop'],
  [/\bACROBAT\b/, 'Adobe Acrobat'],
  [/\bLIGHTROOM\b/, 'Adobe Lightroom'],
  [/\bILLUSTRATOR\b/, 'Adobe Illustrator'],
  [/\bPREMIERE\b/, 'Adobe Premiere'],
  [/\bINDESIGN\b/, 'Adobe InDesign'],
  [/\bADOBE\b/, 'Adobe'],
  [/\bMICROSOFT\s*\*?\s*(365|OFFICE)\b|\bM365\b|\bMSFT\s*\*?\s*(365|OFFICE)\b/, 'Microsoft 365'],
  [/\bMICROSOFT\b|\bMSFT\b/, 'Microsoft'],
  [/\bXFINITY\b/, 'Xfinity'],
  [/\bCOMCAST\b/, 'Comcast'],
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

/** Canonical names produced by explicit brand rules above (not arbitrary Title Case output). */
export const KNOWN_BRAND_NAMES: readonly string[] = [...new Set(BRANDS.map(([, name]) => name))];

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

const SMALL_WORDS = new Set(['THE', 'AND', 'FOR']);

function titleCase(word: string): string {
  // Short all-caps words are abbreviations (NYT, ADT, YMCA-like): keep as is.
  if (/^[A-Z]{1,3}$/.test(word) && !SMALL_WORDS.has(word)) return word;
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
