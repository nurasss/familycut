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
/**
 * Line numbers (errors[].line) are the numbers the user sees in what they pasted/uploaded:
 *  - free-form pasted lines (no header): the first pasted line is line 1;
 *  - CSV file or pasted CSV with a header row: the header is line 1, the first data row is line 2 (like Excel).
 * Rows produced by parseCsv / parsePaste remember the physical line they start on (blank lines and multi-line quoted
 * cells are counted); for any other row the line is `index + 2`. Every error also carries `index`, the 0-based position in the
 * array passed to applyMapping, which is what UIs should use to find the offending row.
 */
const pasteLines = new WeakMap<RawRow, number>();

/**
 * Largest amount accepted from an import, in cents. Same $1,000,000 cap as manual entry and POST /api/ai/action, so an
 * imported amount can never be rejected later and annual totals (x52) stay far below Number.MAX_SAFE_INTEGER.
 */
export const MAX_AMOUNT_CENTS = 100_000_000;

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

/**
 * Per-row parser diagnostics. Kept outside RawRow (a plain Record<string,string>) so the public row shape and the
 * UI contract do not change; applyMapping reads them and reports them through ParseResult.errors. The WeakMap is
 * keyed by row identity: a row the user corrects in the UI is a new object, so its diagnostic is gone with it.
 * Raw extra cells are never stored: only counts and column names.
 */
type RowIssue =
  | { kind: 'too_many'; expected: number; found: number }
  | { kind: 'too_few'; expected: number; found: number; missing: string[] };
const rowIssues = new WeakMap<RawRow, RowIssue>();

type PapaRecord = {
  data: Record<string, string | string[] | undefined>;
  errors: { type: string; code: string; row?: number; index?: number }[];
  cursor: number;
};

/**
 * Number of physical line breaks in s[from, to): LF, CRLF and a lone CR each count once (a CRLF is counted at its LF,
 * so a pair is never counted twice and a range boundary inside a pair cannot double count).
 */
const countBreaks = (s: string, from = 0, to = s.length): number => {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || (c === 13 && s.charCodeAt(i + 1) !== 10)) n++;
  }
  return n;
};

/**
 * Parse CSV text with Papa Parse and keep what it reports (result.errors):
 *  - MissingQuotes / InvalidQuotes: a quote that is never closed (or closed wrongly) makes Papa swallow the following
 *    lines into one field, so record boundaries after it are unknowable. That is a structural error, thrown with the
 *    line number, instead of silently losing rows or inventing a recovery. This includes the header row.
 *  - TooManyFields (non-blank extra cells) / TooFewFields: the record is kept and flagged; applyMapping reports it as
 *    a row error, neighbouring rows are unaffected.
 * Line numbers are physical lines of `text` (LF, CRLF and CR line breaks, blank lines and multi-line quoted cells counted).
 */
function rowsFromPapa(text: string): RawRow[] {
  const options = {
    header: true,
    skipEmptyLines: 'greedy' as const,
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (h: string) => h.trim(),
  };
  const records: PapaRecord[] = [];
  let fields: string[] | undefined;
  Papa.parse<Record<string, string | string[] | undefined>>(text, {
    ...options,
    step: (r, parser) => {
      fields ??= r.meta.fields;
      records.push({ data: r.data, errors: r.errors, cursor: r.meta.cursor });
      if (records.length > MAX_ROWS + 1) parser.abort();
    },
  });

  const throwQuoteError = (errors: PapaRecord['errors'], fallbackOffset: number) => {
    const q = errors.find((e) => e.type === 'Quotes');
    if (!q) return;
    const line = countBreaks(text, 0, Math.max(0, (q.index ?? fallbackOffset) - 1)) + 1;
    throw new Error(
      q.code === 'InvalidQuotes'
        ? `Line ${line}: unexpected characters after a closing quote, so the rows from here on cannot be separated reliably. Nothing was imported. Fix or remove the quote in your file and try again.`
        : `Line ${line}: a quoted field is never closed, so the rows from here on cannot be separated reliably. Nothing was imported. Add the missing closing quote (or remove the stray one) in your file and try again.`,
    );
  };

  if (records.length === 0) {
    // No record reached step: either a header-only file or a header that Papa could not finish (unclosed quote in the
    // header swallows the whole file). Read the header the plain way and keep its diagnostics.
    const plain = Papa.parse(text, options);
    throwQuoteError(plain.errors, text.length);
    fields = plain.meta.fields;
  }

  const headers = (fields ?? []).filter((h) => h !== '');
  if (headers.length === 0) throw new Error('Could not find a header row in this file.');
  if (records.length > MAX_ROWS) {
    throw new Error(`Too many rows (max ${MAX_ROWS.toLocaleString('en-US')}).`);
  }
  for (const rec of records) throwQuoteError(rec.errors, rec.cursor);

  let scanned = 0; // line breaks in text[0, scannedTo): extended record by record, so the whole pass stays linear
  let scannedTo = 0;
  return records.map((rec) => {
    const raw = rec.data;
    const extras = Array.isArray(raw.__parsed_extra) ? raw.__parsed_extra : [];
    const row: RawRow = {};
    for (const h of headers) row[h] = (typeof raw[h] === 'string' ? (raw[h] as string) : '').trim();

    // Physical line where this record starts: the line its end falls on, minus line breaks inside its cells.
    const cells = [...Object.values(raw).filter((v): v is string => typeof v === 'string'), ...extras];
    // When Papa's newline guess is LF but the file has CRLF, the last cell keeps the CR of its terminator; that CR is
    // counted once at the LF, not as a break inside the cell.
    const lastIdx = cells.length - 1;
    const inner = cells.reduce(
      (n, c, i) => n + countBreaks(i === lastIdx && c.endsWith('\r') ? c.slice(0, -1) : c),
      0,
    );
    const last = text.charCodeAt(rec.cursor - 1);
    const terminated = last === 10 || last === 13;
    scanned += countBreaks(text, scannedTo, rec.cursor);
    scannedTo = rec.cursor;
    const start = Math.max(1, scanned + 1 - inner - (terminated ? 1 : 0));
    pasteLines.set(row, start);

    if (extras.some((c) => c.trim() !== '')) {
      rowIssues.set(row, { kind: 'too_many', expected: headers.length, found: headers.length + extras.length });
    } else if (rec.errors.some((e) => e.code === 'TooFewFields')) {
      const missing = headers.filter((h) => typeof raw[h] !== 'string');
      if (missing.length > 0) {
        rowIssues.set(row, { kind: 'too_few', expected: headers.length, found: headers.length - missing.length, missing });
      }
    }
    return row;
  });
}

/** Strict-ish date parser. Returns YYYY-MM-DD or null. */
/** Line number the user sees for a raw row (see "Line numbers" above). `index` is its 0-based position. */
export function rowLine(row: RawRow, index: number): number {
  return pasteLines.get(row) ?? index + 2;
}

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
  const numbered = clean
    .split(/\r?\n/)
    .map((l, i) => ({ text: l.trim(), line: i + 1 }))
    .filter((l) => l.text !== '');
  const lines = numbered.map((l) => l.text);
  if (lines.length === 0) return [];
  if (lines.length > MAX_ROWS + 1) throw new Error(`Too many rows (max ${MAX_ROWS.toLocaleString('en-US')}).`);

  const first = lines[0];
  if (/date/i.test(first) && /[,;\t]/.test(first) && !PASTE_LINE.test(first)) {
    // Whole original text: quoted cells keep their content (blank lines inside a cell included) and line numbers are
    // the pasted ones. Only free-form lines below are split, trimmed and numbered one by one.
    return rowsFromPapa(clean);
  }

  return numbered.map(({ text: line, line: lineNo }) => {
    const m = PASTE_LINE.exec(line);
    let row: RawRow;
    if (!m) {
      row = { Date: '', Description: line, Amount: '' };
    } else {
      const description = m[2].trim().replace(/^"(.*)"$/, '$1');
      row = { Date: m[1], Description: description, Amount: m[3].trim() };
    }
    pasteLines.set(row, lineNo);
    return row;
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
    const line = pasteLines.get(row) ?? i + 2; // see "Line numbers" above
    const fail = (reason: string) => void errors.push({ line, index: i, reason });
    const dateRaw = (row[mapping.date] ?? '').trim();
    const description = (row[mapping.description] ?? '').trim();

    // Parser diagnostics first (see rowsFromPapa): a record whose fields cannot be trusted is never imported silently.
    const issue = rowIssues.get(row);
    if (issue?.kind === 'too_many') {
      return fail(`Too many columns (found ${issue.found}, expected ${issue.expected}) — an unquoted comma may have split a field`);
    }
    if (issue?.kind === 'too_few') {
      const mapped = [mapping.date, mapping.description, mapping.amount, mapping.debitColumn];
      const lost = issue.missing.filter((h) => mapped.includes(h));
      if (lost.length > 0) {
        return fail(`Too few columns (found ${issue.found}, expected ${issue.expected}) — missing: ${lost.join(', ')}`);
      }
    }

    if (!dateRaw) return fail('Missing date');
    const date = parseDate(dateRaw);
    if (!date) return fail('Invalid date');
    if (!description) return fail('Missing description');

    // Signed amount: negative = money out.
    let signed: number;
    const amountRaw = (row[mapping.amount] ?? '').trim();
    if (mapping.debitColumn && mapping.debitColumn !== mapping.amount) {
      // Separate Debit / Credit columns (mapping.amount is the credit column): parse both numerically. The unused
      // side may be empty or 0; two non-zero sides are ambiguous and never resolved by a hidden priority.
      const debitRaw = (row[mapping.debitColumn] ?? '').trim();
      const debit = debitRaw ? parseAmountCents(debitRaw) : 0;
      const credit = amountRaw ? parseAmountCents(amountRaw) : 0;
      if (debit === null || credit === null) return fail('Invalid amount');
      if (debit !== 0 && credit !== 0) return fail('Both Debit and Credit have an amount');
      if (debit !== 0) signed = -Math.abs(debit);
      else if (credit !== 0) signed = Math.abs(credit);
      else return fail(debitRaw || amountRaw ? 'Zero amount' : 'Missing amount');
    } else {
      if (!amountRaw) return fail('Missing amount');
      const v = parseAmountCents(amountRaw);
      if (v === null) return fail('Invalid amount');
      signed = mapping.signConvention === 'negative_is_debit' ? v : -v;
    }
    if (signed === 0) return fail('Zero amount');
    if (Math.abs(signed) > MAX_AMOUNT_CENTS) return fail('Amount too large (max $1,000,000)');

    const idRaw = mapping.transactionId ? (row[mapping.transactionId] ?? '').trim() : '';
    const incoming = signed > 0;
    pending.push({
      incoming,
      tx: {
        id: idRaw || `${GENERATED_ID_PREFIX}${i + 2}`,
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
