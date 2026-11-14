// Import: CSV / pasted text -> RawRow[] -> Transaction[] (TZ §7.1, §7.2). Runs in the browser, nothing is uploaded.
//
// Transaction sign convention produced by applyMapping:
//   amountCents > 0               money out (a debit / purchase)
//   amountCents < 0, isRefund     refund of a purchase (excluded from spend)
//   amountCents < 0, !isRefund    incoming credit, e.g. payroll (not an expense)
import Papa from 'papaparse';
import { normalizeMerchant } from '@/lib/engine/normalize';
import type { ColumnMapping, ParseResult, RawRow, Transaction } from '@/lib/types';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
/** Prefix of ids generated for rows without a real bank transaction ID. */
export const GENERATED_ID_PREFIX = 'row-';

// ---------- helpers ----------

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function checkSize(text: string): void {
  // Cheap pre-check (UTF-16 length ≤ bytes ≤ 3× length) to avoid encoding huge strings needlessly.
  if (text.length * 3 > MAX_FILE_BYTES && byteLength(text) > MAX_FILE_BYTES) {
    throw new Error('File is too large (max 5 MB).');
  }
}

function rowsFromPapa(text: string): RawRow[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h !== '');
  if (headers.length === 0) throw new Error('Could not find a header row in this file.');
  if (result.data.length > MAX_ROWS) {
    throw new Error(`Too many rows (max ${MAX_ROWS.toLocaleString('en-US')}).`);
  }
  return result.data.map((r) => {
    const row: RawRow = {};
    for (const h of headers) row[h] = (r[h] ?? '').toString().trim();
    return row;
  });
}

/** Strict-ish date parser. Returns YYYY-MM-DD or null. */
export function parseDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    y = +match[1];
    m = +match[2];
    d = +match[3];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    m = +match[1];
    d = +match[2];
    y = match[3].length === 2 ? 2000 + +match[3] : +match[3];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/**
 * "$1,234.56", "(15.49)", "-15.49", "15.49-", "15,49" -> signed integer cents (no floats). null if invalid.
 */
export function parseAmountCents(input: string): number | null {
  let s = input.trim().replace(/\s+/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/^\$/, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (/^\d+,\d{2}$/.test(s)) s = s.replace(',', '.'); // decimal comma
  s = s.replace(/,/g, '');
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const whole = m[1] === '' ? 0 : parseInt(m[1], 10);
  const frac = (m[2] ?? '').padEnd(3, '0');
  let cents = whole * 100 + parseInt(frac.slice(0, 2), 10);
  if (parseInt(frac[2], 10) >= 5) cents += 1; // round half up on 3rd decimal
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

// ---------- CSV / paste ----------

/** Parse CSV text (comma/semicolon/tab auto-detected, BOM-safe) into raw rows keyed by header. Throws on limits. */
export function parseCsv(text: string): RawRow[] {
  checkSize(text);
  return rowsFromPapa(stripBom(text));
}

const PASTE_LINE =
  /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))[\s,;\t]+(.*?)[\s,;\t]+([-+]?\(?-?\$?\s?[\d,]*\d(?:\.\d+)?\)?-?)\s*$/;

/**
 * Parse pasted text. Accepts a CSV with a header row (delegates to parseCsv), or free lines like
 * "2026-10-03 NETFLIX.COM 8844 -15.49" (date, description, amount at the end).
 * Free lines produce Date/Description/Amount columns; lines that don't match are kept with empty
 * Date/Amount so applyMapping reports them as errors instead of silently dropping them.
 */
export function parsePaste(text: string): RawRow[] {
  checkSize(text);
  const clean = stripBom(text);
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > MAX_ROWS + 1) throw new Error(`Too many rows (max ${MAX_ROWS.toLocaleString('en-US')}).`);

  const first = lines[0];
  if (/date/i.test(first) && /[,;\t]/.test(first) && !PASTE_LINE.test(first)) {
    return rowsFromPapa(lines.join('\n'));
  }

  return lines.map((line) => {
    const m = PASTE_LINE.exec(line);
    if (!m) return { Date: '', Description: line, Amount: '' };
    const description = m[2].trim().replace(/^"(.*)"$/, '$1');
    return { Date: m[1], Description: description, Amount: m[3].trim() };
  });
}

// ---------- mapping ----------

const REFUND_WORDS = /\b(REFUND|REFUNDED|RETURN|REVERSAL|CHARGEBACK)\b/i;

/** Apply the user's column mapping. Bad rows go to `errors`; the rest keep parsing (FR-05). */
export function applyMapping(rows: RawRow[], mapping: ColumnMapping): ParseResult {
  const errors: ParseResult['errors'] = [];
  type Pending = { tx: Transaction; incoming: boolean };
  const pending: Pending[] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // header = line 1
    const dateRaw = (row[mapping.date] ?? '').trim();
    const description = (row[mapping.description] ?? '').trim();

    if (!dateRaw) return void errors.push({ line, reason: 'Missing date' });
    const date = parseDate(dateRaw);
    if (!date) return void errors.push({ line, reason: 'Invalid date' });
    if (!description) return void errors.push({ line, reason: 'Missing description' });

    // Signed amount: negative = money out.
    let signed: number;
    const debitRaw = mapping.debitColumn ? (row[mapping.debitColumn] ?? '').trim() : '';
    const amountRaw = (row[mapping.amount] ?? '').trim();
    if (mapping.debitColumn && debitRaw) {
      const debit = parseAmountCents(debitRaw);
      if (debit === null) return void errors.push({ line, reason: 'Invalid amount' });
      signed = -Math.abs(debit);
    } else {
      if (!amountRaw) return void errors.push({ line, reason: 'Missing amount' });
      const v = parseAmountCents(amountRaw);
      if (v === null) return void errors.push({ line, reason: 'Invalid amount' });
      if (mapping.debitColumn) signed = Math.abs(v); // separate credit column
      else signed = mapping.signConvention === 'negative_is_debit' ? v : -v;
    }
    if (signed === 0) return void errors.push({ line, reason: 'Zero amount' });

    const idRaw = mapping.transactionId ? (row[mapping.transactionId] ?? '').trim() : '';
    const incoming = signed > 0;
    pending.push({
      incoming,
      tx: {
        id: idRaw || `${GENERATED_ID_PREFIX}${line}`,
        date,
        merchantRaw: description,
        merchantNormalized: normalizeMerchant(description),
        amountCents: -signed, // debit -> positive, incoming -> negative
        isRefund: false,
        currency: 'USD',
      },
    });
  });

  // Refund = incoming money from a merchant we also paid, or an explicit refund word.
  const paidMerchants = new Set(pending.filter((p) => !p.incoming).map((p) => p.tx.merchantNormalized));
  for (const p of pending) {
    if (p.incoming && (REFUND_WORDS.test(p.tx.merchantRaw) || paidMerchants.has(p.tx.merchantNormalized))) {
      p.tx.isRefund = true;
    }
  }

  return { rows: pending.map((p) => p.tx), errors };
}

// ---------- mapping suggestion ----------

const find = (headers: string[], ...patterns: RegExp[]): string | undefined => {
  for (const p of patterns) {
    const h = headers.find((x) => p.test(x.trim()));
    if (h) return h;
  }
  return undefined;
};

/** Guess a ColumnMapping from header names. Returns null if date/description/amount can't be found. */
export function suggestMapping(headers: string[]): ColumnMapping | null {
  const date = find(
    headers,
    /^(transaction|trans\.?|posting|posted|post)?[\s_-]*date$/i,
    /^date/i,
    /date/i,
  );
  const description = find(
    headers,
    /^description$/i,
    /description|merchant|payee|vendor|details|memo|narrative/i,
  );
  const amountCol = find(headers, /^amount$/i, /amount/i);
  const debit = find(headers, /^debit/i, /debit|withdrawal/i);
  const credit = find(headers, /^credit/i, /credit|deposit/i);
  const transactionId = find(
    headers,
    /transaction[\s_-]*id/i,
    /^(ref|reference)([\s_-]*(no|num|number|id))?\.?$/i,
    /reference/i,
    /^id$/i,
  );

  let amount = amountCol;
  let debitColumn: string | undefined;
  if (!amount && (debit || credit)) {
    amount = credit ?? debit;
    debitColumn = debit;
  }
  if (!date || !description || !amount) return null;

  const mapping: ColumnMapping = { date, description, amount, signConvention: 'negative_is_debit' };
  if (debitColumn) mapping.debitColumn = debitColumn;
  if (transactionId) mapping.transactionId = transactionId;
  return mapping;
}
