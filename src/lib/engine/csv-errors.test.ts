// Regression tests for F07 (Papa Parse errors are not ignored) and F08 (separate Debit / Credit columns).
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import type { ColumnMapping, RawRow } from '@/lib/types';
import { analyzeTransactions } from './detect';
import { MAX_AMOUNT_CENTS, applyMapping, parseCsv, parsePaste, rowLine, suggestMapping } from './parse';

const MAPPING: ColumnMapping = { date: 'Date', description: 'Description', amount: 'Amount', signConvention: 'negative_is_debit' };
const ok = (n: number) => `2026-10-${String(n).padStart(2, '0')},SHOP ${n},-${n}.00`;

describe('F07 TooManyFields / TooFewFields', () => {
  it('a row with extra cells is reported with the right index and line; neighbours are imported', () => {
    const csv = ['Date,Description,Amount', ok(1), '2026-10-02,ACME, INC,-5.00', ok(3)].join('\n');
    const { rows, errors } = applyMapping(parseCsv(csv), MAPPING);
    expect(rows.map((t) => t.merchantRaw)).toEqual(['SHOP 1', 'SHOP 3']);
    expect(errors).toEqual([
      { line: 3, index: 1, reason: 'Too many columns (found 4, expected 3) — an unquoted comma may have split a field' },
    ]);
  });

  it('extra cells are never kept in the row (not persisted, not sent anywhere)', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-10-02,ACME,-5.00,SECRET-EXTRA');
    expect(Object.keys(rows[0])).toEqual(['Date', 'Description', 'Amount']);
    expect(JSON.stringify(rows)).not.toContain('SECRET-EXTRA');
  });

  it('empty trailing cells (a trailing comma on every row) are not an error', () => {
    const csv = ['Date,Description,Amount', '2026-10-01,A,-1.00,', '2026-10-02,B,-2.00,,'].join('\n');
    const { rows, errors } = applyMapping(parseCsv(csv), MAPPING);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('a row that lost a mapped column is an error naming it; a missing unmapped column is fine', () => {
    const csv = ['Date,Description,Amount,Notes', '2026-10-01,A,-1.00,x', '2026-10-02,B', '2026-10-03,C,-3.00'].join('\n');
    const rows = parseCsv(csv);
    const r = applyMapping(rows, MAPPING);
    expect(r.errors).toEqual([{ line: 3, index: 1, reason: 'Too few columns (found 2, expected 4) — missing: Amount' }]);
    expect(r.rows.map((t) => t.merchantRaw)).toEqual(['A', 'C']);

    const onlyNotes = parseCsv(['Date,Description,Amount,Notes', '2026-10-01,A,-1.00'].join('\n'));
    expect(applyMapping(onlyNotes, MAPPING).errors).toEqual([]);
  });

  it('line numbers are physical: blank lines and multi-line quoted cells are counted', () => {
    const csv = [
      'Date,Description,Amount', // 1
      '', // 2
      '2026-10-01,"A', // 3
      'B",-1.00', // 4
      '', // 5
      '2026-10-02,C,-2.00,EXTRA', // 6
      '2026-10-03,D,-3.00', // 7
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rowLine(rows[0], 0)).toBe(3);
    const { errors } = applyMapping(rows, MAPPING);
    expect(errors).toEqual([expect.objectContaining({ line: 6, index: 1 })]);
    expect(rowLine(rows[2], 2)).toBe(7);
  });

  it('pasted CSV with a header keeps the line numbers of the pasted text (blank lines counted)', () => {
    const text = 'Date,Description,Amount\n\n2026-10-01,A,-1.00\n\n2026-10-02,B,-2.00,EXTRA';
    const { errors } = applyMapping(parsePaste(text), MAPPING);
    expect(errors).toEqual([expect.objectContaining({ line: 5, index: 1 })]);
  });

  it('manual correction of a flagged row clears its diagnostic; the original stays flagged', () => {
    const [bad, good] = parseCsv('Date,Description,Amount\n2026-10-01,ACME, INC,-5.00\n2026-10-02,B,-2.00');
    expect(applyMapping([bad, good], MAPPING).errors).toHaveLength(1);
    const fixed: RawRow = { ...bad, Description: 'ACME INC', Amount: '-5.00' }; // what the UI editor produces
    const after = applyMapping([fixed, good], MAPPING);
    expect(after.errors).toEqual([]);
    expect(after.rows.map((t) => [t.merchantRaw, t.amountCents])).toEqual([['ACME INC', 500], ['B', 200]]);
    expect(applyMapping([bad, good], MAPPING).errors).toHaveLength(1);
  });

  it('semicolon / tab files and escaped quotes still parse without errors', () => {
    const semi = parseCsv('Date;Description;Amount\n2026-10-01;"A; B";-1,50');
    expect(applyMapping(semi, MAPPING)).toMatchObject({ errors: [], rows: [{ merchantRaw: 'A; B', amountCents: 150 }] });
    const quoted = parseCsv('Date,Description,Amount\n2026-10-01,"A ""x"" B",-1.00');
    expect(quoted[0].Description).toBe('A "x" B');
  });

  it('a header-only file is an empty import, not an error', () => {
    expect(parseCsv('Date,Description,Amount\n')).toEqual([]);
  });
});

describe('F07 unclosed / invalid quotes are a structural error, not a silent loss', () => {
  it('MissingQuotes: throws with the line of the quote; nothing is half-imported', () => {
    const csv = ['Date,Description,Amount', ok(1), '2026-10-02,"B,-2.00', ok(3), ok(4)].join('\n');
    expect(() => parseCsv(csv)).toThrowError(/^Line 3: a quoted field is never closed/);
    expect(() => parseCsv(csv)).toThrowError(/Nothing was imported/);
  });

  it('MissingQuotes in the last row', () => {
    expect(() => parseCsv(['Date,Description,Amount', ok(1), '2026-10-02,"B,-2.00'].join('\n'))).toThrowError(/^Line 3:/);
  });

  it('InvalidQuotes: characters after a closing quote', () => {
    const csv = ['Date,Description,Amount', ok(1), '2026-10-02,"B" x,-2.00', ok(3)].join('\n');
    expect(() => parseCsv(csv)).toThrowError(/^Line 3: unexpected characters after a closing quote/);
  });

  it('the message never contains the swallowed data', () => {
    const csv = ['Date,Description,Amount', '2026-10-02,"B,-2.00', '2026-10-03,SECRET MERCHANT,-9.99'].join('\n');
    try {
      parseCsv(csv);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRET MERCHANT');
    }
  });

  it('the line is the pasted line even with blank lines (pasted CSV with a header)', () => {
    const text = 'Date,Description,Amount\n\n2026-10-01,A,-1.00\n\n2026-10-02,"B,-2.00';
    expect(() => parsePaste(text)).toThrowError(/^Line 5:/);
  });

  it('a quote inside an unquoted word is plain text, not an error', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-10-02,5" PIZZA,-2.00');
    expect(rows[0].Description).toBe('5" PIZZA');
    expect(applyMapping(rows, MAPPING).errors).toEqual([]);
  });
});

describe('F08 separate Debit / Credit columns are parsed numerically', () => {
  const header = 'Date,Description,Debit,Credit';
  const run = (...lines: string[]) => {
    const rows = parseCsv([header, ...lines].join('\n'));
    const mapping = suggestMapping(Object.keys(rows[0]))!;
    return { mapping, ...applyMapping(rows, mapping) };
  };

  it('suggestMapping puts Debit in debitColumn and Credit in amount', () => {
    expect(run('2026-10-03,A,1.00,').mapping).toMatchObject({ debitColumn: 'Debit', amount: 'Credit' });
  });

  it('Debit=0, Credit=15.49 is incoming money / a refund, not "Zero amount"', () => {
    const r = run('2026-10-06,NETFLIX.COM REFUND,0,15.49', '2026-10-03,NETFLIX.COM,15.49,0');
    expect(r.errors).toEqual([]);
    const [refund, spend] = r.rows;
    expect(refund).toMatchObject({ amountCents: -1549, isRefund: true });
    expect(spend).toMatchObject({ amountCents: 1549, isRefund: false });
  });

  it('Debit=15.49, Credit=0 / 0.00 / empty is an expense', () => {
    for (const credit of ['0', '0.00', '']) {
      const r = run(`2026-10-03,NETFLIX.COM,15.49,${credit}`);
      expect(r.errors, credit).toEqual([]);
      expect(r.rows[0].amountCents).toBe(1549);
    }
  });

  it('Debit=0 or empty with a Credit is incoming (payroll)', () => {
    for (const debit of ['0', '0.00', '']) {
      const r = run(`2026-10-31,PAYROLL ACME,${debit},3200.00`);
      expect(r.errors, debit).toEqual([]);
      expect(r.rows[0]).toMatchObject({ amountCents: -320000, isRefund: false });
    }
  });

  it('two non-zero sides are an explicit error, never a hidden Debit priority', () => {
    const r = run('2026-10-03,AMBIGUOUS,15.49,15.49', '2026-10-04,OK,1.00,');
    expect(r.rows.map((t) => t.merchantRaw)).toEqual(['OK']);
    expect(r.errors).toEqual([{ line: 2, index: 0, reason: 'Both Debit and Credit have an amount' }]);
  });

  it('two zeros are "Zero amount"; both empty is "Missing amount"; a zero plus an empty is "Zero amount"', () => {
    expect(run('2026-10-03,A,0,0').errors[0].reason).toBe('Zero amount');
    expect(run('2026-10-03,A,0.00,0.00').errors[0].reason).toBe('Zero amount');
    expect(run('2026-10-03,A,0,').errors[0].reason).toBe('Zero amount');
    expect(run('2026-10-03,A,,0').errors[0].reason).toBe('Zero amount');
    expect(run('2026-10-03,A,,').errors[0].reason).toBe('Missing amount');
  });

  it('text in either column is "Invalid amount" even if the other side is fine', () => {
    expect(run('2026-10-03,A,oops,').errors[0].reason).toBe('Invalid amount');
    expect(run('2026-10-03,A,,oops').errors[0].reason).toBe('Invalid amount');
    expect(run('2026-10-03,A,5.00,oops').errors[0].reason).toBe('Invalid amount');
  });

  it('the original F08 case end to end: three months of Debit=15.49, Credit=0 is a monthly subscription', () => {
    const r = run('2026-08-03,NETFLIX.COM,15.49,0', '2026-09-03,NETFLIX.COM,15.49,0', '2026-10-03,NETFLIX.COM,15.49,0');
    expect(r.errors).toEqual([]);
    const [e] = analyzeTransactions(r.rows).expenses;
    expect(e).toMatchObject({ merchant: 'Netflix', frequency: 'monthly', priceCents: 1549, confidence: 'high' });
  });

  it('a single Amount column keeps both sign conventions and the old errors', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-10-03,A,-15.49\n2026-10-04,B,15.49\n2026-10-05,C,0\n2026-10-06,D,');
    const neg = applyMapping(rows, MAPPING);
    expect(neg.rows.map((t) => t.amountCents)).toEqual([1549, -1549]);
    expect(neg.errors.map((e) => e.reason)).toEqual(['Zero amount', 'Missing amount']);
    const pos = applyMapping(rows, { ...MAPPING, signConvention: 'positive_is_debit' });
    expect(pos.rows.map((t) => t.amountCents)).toEqual([-1549, 1549]);
  });

  it('the same column chosen as Debit and Amount is treated as a single amount column', () => {
    const rows = parseCsv('Date,Description,Debit\n2026-10-03,A,15.49');
    const r = applyMapping(rows, { date: 'Date', description: 'Description', amount: 'Debit', debitColumn: 'Debit', signConvention: 'positive_is_debit' });
    expect(r.errors).toEqual([]);
    expect(r.rows[0].amountCents).toBe(1549); // positive_is_debit: 15.49 is money out
  });
});

describe('F08 amount limits match manual entry and the API ($1,000,000)', () => {
  const amountRows = (v: string) => applyMapping(parseCsv(`Date,Description,Amount\n2026-10-03,BIG,-${v}`), MAPPING);

  it('exactly the cap is accepted, one cent more is a row error', () => {
    expect(MAX_AMOUNT_CENTS).toBe(100_000_000);
    expect(amountRows('1000000.00').rows[0].amountCents).toBe(MAX_AMOUNT_CENTS);
    expect(amountRows('1000000.01').errors).toEqual([{ line: 2, index: 0, reason: 'Amount too large (max $1,000,000)' }]);
  });

  it('absurd values never reach the money engine (not a safe integer -> Invalid amount)', () => {
    expect(amountRows('99999999999999999999').errors[0].reason).toBe('Invalid amount');
    expect(amountRows('90071992547409.93').errors[0].reason).toMatch(/too large|Invalid/);
  });

  it('the cap also applies to a Debit / Credit pair', () => {
    const rows = parseCsv('Date,Description,Debit,Credit\n2026-10-03,A,1000000.01,\n2026-10-03,B,,1000000.01');
    const mapping = suggestMapping(Object.keys(rows[0]))!;
    expect(applyMapping(rows, mapping).errors.map((e) => e.reason)).toEqual([
      'Amount too large (max $1,000,000)',
      'Amount too large (max $1,000,000)',
    ]);
  });
});

describe('W3B2 header quotes, CR / LF / CRLF line numbers, multi-line paste', () => {
  const EOLS: [string, string][] = [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']];

  it('an unclosed quote in the header row is a structural error with its line (also when no record is read)', () => {
    expect(() => parseCsv('Date,"Description,Amount\n2026-01-01,A,-15')).toThrowError(/^Line 1: a quoted field is never closed/);
    expect(() => parseCsv('Date,"Description,Amount')).toThrowError(/^Line 1:/);
    expect(() => parsePaste('Date,"Description,Amount\n2026-01-01,A,-15')).toThrowError(/^Line 1:/);
    expect(() => parseCsv('\n\nDate,"Description,Amount\n2026-01-01,A,-15')).toThrowError(/^Line 3:/);
    expect(() => parseCsv('Date,"Description,Amount\n2026-01-01,A,-15')).toThrowError(/Nothing was imported/);
    for (const [name, eol] of EOLS) {
      expect(() => parseCsv(`Date,"Description,Amount${eol}2026-01-01,A,-15`), name).toThrowError(/^Line 1:/);
    }
  });

  it('a valid header-only file is still an empty import (any line ending, with or without a final newline)', () => {
    for (const t of ['Date,Description,Amount', 'Date,Description,Amount\n', 'Date,Description,Amount\r\n', 'Date,Description,Amount\r', '\n\nDate,Description,Amount\n\n']) {
      expect(parseCsv(t), JSON.stringify(t)).toEqual([]);
      expect(parsePaste(t), JSON.stringify(t)).toEqual([]);
    }
  });

  it('CR-only line endings: rows are on lines 2 and 3 and the error is on line 3', () => {
    const rows = parseCsv('Date,Description,Amount\r2026-01-01,A,-15\r2026-02-01,A,-15,EXTRA');
    expect(rows.map((r, i) => rowLine(r, i))).toEqual([2, 3]);
    expect(applyMapping(rows, MAPPING).errors).toEqual([expect.objectContaining({ line: 3, index: 1 })]);
  });

  it.each(EOLS)('%s: blank lines, a multi-line quoted cell and an error row get physical line numbers', (_n, eol) => {
    const text = [
      'Date,Description,Amount', // 1
      '', // 2
      `2026-10-01,"A${eol}B",-1.00`, // 3-4 (quoted cell spans two lines)
      '', // 5
      '2026-10-02,C,-2.00,EXTRA', // 6
      '2026-10-03,D,-3.00', // 7
    ].join(eol);
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3);
    expect(rows[0].Description).toBe(`A${eol}B`);
    expect(rows.map((r, i) => rowLine(r, i))).toEqual([3, 6, 7]);
    const { errors, rows: ok } = applyMapping(rows, MAPPING);
    expect(errors).toEqual([expect.objectContaining({ line: 6, index: 1 })]);
    expect(ok.map((t) => t.merchantRaw)).toHaveLength(2);
    // same text with a trailing line break
    const again = parseCsv(text + eol);
    expect(again.map((r, i) => rowLine(r, i))).toEqual([3, 6, 7]);
  });

  it.each(EOLS)('%s: quote errors report the line of the broken quote', (_n, eol) => {
    const text = ['Date,Description,Amount', '2026-10-01,A,-1.00', '2026-10-02,"B,-2.00', '2026-10-03,C,-3.00'].join(eol);
    expect(() => parseCsv(text)).toThrowError(/^Line 3: a quoted field is never closed/);
    const invalid = ['Date,Description,Amount', '', '2026-10-02,"B" x,-2.00', '2026-10-03,C,-3.00'].join(eol);
    expect(() => parseCsv(invalid)).toThrowError(/^Line 3: unexpected characters after a closing quote/);
  });

  it('a file that mixes LF and CRLF still gets the right lines (CRLF counted once)', () => {
    const rows = parseCsv('Date,Description,Amount\n2026-01-01,A,-15\r\n2026-02-01,A,-15,EXTRA\r\n2026-03-01,B,-3\n');
    expect(rows.map((r, i) => rowLine(r, i))).toEqual([2, 3, 4]);
    expect(applyMapping(rows, MAPPING).errors).toEqual([expect.objectContaining({ line: 3, index: 1 })]);
  });

  it('pasted CSV keeps a blank line inside a quoted cell, exactly like parseCsv', () => {
    const text = 'Date,Description,Amount\n2026-01-01,"hello\n\nworld",-15';
    const pasted = parsePaste(text);
    expect(pasted[0].Description).toBe('hello\n\nworld');
    expect(pasted).toEqual(parseCsv(text));
    for (const [name, eol] of EOLS) {
      const t = ['Date,Description,Amount', `2026-01-01,"hello${eol}${eol}world",-15`].join(eol);
      expect(parsePaste(t)[0].Description, name).toBe(`hello${eol}${eol}world`);
      expect(parsePaste(t), name).toEqual(parseCsv(t));
    }
  });

  it('pasted CSV: real line numbers after blank lines and after a multi-line cell; error rows keep their diagnostics', () => {
    const text = ['', 'Date,Description,Amount', '2026-01-01,"x', '', 'y",-1.00', '', '2026-01-02,B,-2.00,EXTRA', '2026-01-03,C,-3.00'].join('\n');
    const rows = parsePaste(text);
    expect(rows.map((r, i) => rowLine(r, i))).toEqual([3, 7, 8]);
    expect(applyMapping(rows, MAPPING).errors).toEqual([expect.objectContaining({ line: 7, index: 1 })]);
  });

  it('free-form paste is unchanged: lines are trimmed, blank lines counted, unparsable lines become errors', () => {
    const rows = parsePaste('  2026-10-01 NETFLIX.COM 8844 -15.49  \n\nthis is broken\n2026-10-03 SPOTIFY -16.99');
    expect(rows).toEqual([
      { Date: '2026-10-01', Description: 'NETFLIX.COM 8844', Amount: '-15.49' },
      { Date: '', Description: 'this is broken', Amount: '' },
      { Date: '2026-10-03', Description: 'SPOTIFY', Amount: '-16.99' },
    ]);
    expect(rows.map((r, i) => rowLine(r, i))).toEqual([1, 3, 4]);
  });

  it('limits and diagnostics of neighbouring rows are unchanged', () => {
    const many = ['Date,Description,Amount', ...Array.from({ length: 10_001 }, (_, i) => `2026-01-01,A${i},-1.00`)].join('\n');
    expect(() => parseCsv(many)).toThrowError(/Too many rows/);
    const ten = ['Date,Description,Amount', ...Array.from({ length: 10_000 }, (_, i) => `2026-01-01,A${i},-1.00`)].join('\r');
    const rows = parseCsv(ten);
    expect(rows).toHaveLength(10_000);
    expect(rowLine(rows[9_999], 9_999)).toBe(10_001);
  });
});
