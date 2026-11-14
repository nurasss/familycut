import { describe, expect, it } from 'vitest';
import { DEMO_TRANSACTIONS_CSV } from '@/lib/fixtures/miller';
import type { ColumnMapping, Expense, Transaction } from '@/lib/types';
import { analyzeTransactions, detectRecurring, pickReviewCandidates, STORE_REASON } from './detect';
import { normalizeMerchant } from './normalize';
import { applyMapping, parseAmountCents, parseCsv, parseDate, parsePaste, suggestMapping } from './parse';

const MAPPING: ColumnMapping = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  transactionId: 'Transaction ID',
  signConvention: 'negative_is_debit',
};

function tx(p: Partial<Transaction> & { date: string; merchant: string; cents: number }): Transaction {
  return {
    id: p.id ?? `row-${Math.random()}`,
    date: p.date,
    merchantRaw: p.merchant,
    merchantNormalized: normalizeMerchant(p.merchant),
    amountCents: p.cents,
    isRefund: p.isRefund ?? false,
    currency: 'USD',
  };
}

const monthly = (merchant: string, cents: number, dates: string[]) =>
  dates.map((date, i) => tx({ id: `${merchant}-${i}`, date, merchant, cents }));

describe('normalizeMerchant', () => {
  it.each([
    ['NETFLIX.COM 8844', 'Netflix'],
    ['SPOTIFY USA P3A1B2', 'Spotify'],
    ['PLANET FITNESS #4521 NY', 'Planet Fitness'],
    ['COMCAST CABLE COMM 800-266-2278', 'Comcast'],
    ['ICLOUD.COM/BILL CA', 'iCloud'],
    ['WHOLEFDS MKT 10234', 'Whole Foods'],
    ['ACME WIDGETS #12 TX', 'Acme Widgets'],
    ['NYT DIGITAL SUBSCR', 'New York Times'],
    ['NYTIMES*DIGITAL 800-698-4637', 'New York Times'],
    ['HULU 877-8244858 CA', 'Hulu'],
    ['DISNEY PLUS 888-905-7888', 'Disney+'],
    ['HBO MAX 844-1234', 'HBO Max'],
    ['GOOGLE *YOUTUBE PREMIUM', 'YouTube Premium'],
    ['AMAZON PRIME*2K4TT8 AMZN.COM/BILL WA', 'Amazon Prime'],
    ['APPLE.COM/BILL 866-712-7753 CA', 'Apple'],
    ['GOOGLE *GOOGLE ONE', 'Google One'],
    ['PELOTON MEMBERSHIP', 'Peloton'],
    ['ADT SECURITY SERVICES', 'ADT'],
    ['VERIZON WIRELESS PAYMENT', 'Verizon'],
    ['ATT*BILL PAYMENT', 'AT&T'],
    ['T-MOBILE AUTOPAY', 'T-Mobile'],
    ['XFINITY MOBILE', 'Xfinity'],
    ['SPECTRUM 855-707-7328', 'Spectrum'],
    ['DROPBOX*ABCDEF', 'Dropbox'],
    ['ADOBE *CREATIVE CLOUD', 'Adobe'],
    ['MICROSOFT*365 PERSONAL', 'Microsoft 365'],
    ['ACME GYM 55', 'ACME GYM'.replace('ACME', 'Acme')],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it('keeps short all-caps abbreviations as is', () => {
    expect(normalizeMerchant('XYZ TOOLS')).toBe('XYZ Tools');
  });

  it('does not merge different providers', () => {
    expect(normalizeMerchant('AMAZON PRIME*1234')).not.toBe(normalizeMerchant('AMAZON MKTPLACE'));
    expect(normalizeMerchant('GOOGLE *GOOGLE ONE')).not.toBe(normalizeMerchant('GOOGLE *YOUTUBE'));
  });
});

describe('parse helpers', () => {
  it('parses amounts without floats', () => {
    expect(parseAmountCents('$1,234.56')).toBe(123456);
    expect(parseAmountCents('(15.49)')).toBe(-1549);
    expect(parseAmountCents('-15.49')).toBe(-1549);
    expect(parseAmountCents('15.49-')).toBe(-1549);
    expect(parseAmountCents('$-15.49')).toBe(-1549);
    expect(parseAmountCents('0.1')).toBe(10);
    expect(parseAmountCents('abc')).toBeNull();
    expect(parseAmountCents('')).toBeNull();
  });

  it('parses both date formats and rejects impossible dates', () => {
    expect(parseDate('2026-10-03')).toBe('2026-10-03');
    expect(parseDate('10/03/2026')).toBe('2026-10-03');
    expect(parseDate('13/45/2026')).toBeNull();
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
  });

  it('parseCsv handles BOM and semicolon / tab delimiters', () => {
    const a = parseCsv('﻿Date;Description;Amount\n2026-10-03;NETFLIX;-15.49\n');
    expect(a).toEqual([{ Date: '2026-10-03', Description: 'NETFLIX', Amount: '-15.49' }]);
    const b = parseCsv('Date\tDescription\tAmount\n2026-10-03\tNETFLIX\t-15.49\n');
    expect(b[0].Description).toBe('NETFLIX');
  });

  it('parseCsv enforces limits with readable errors', () => {
    const big = 'Date,Description,Amount\n' + '2026-01-01,X,-1.00\n'.repeat(10_001);
    expect(() => parseCsv(big)).toThrow(/Too many rows/);
    expect(() => parseCsv('a'.repeat(5 * 1024 * 1024 + 1))).toThrow(/too large/);
  });

  it('parsePaste handles free-form lines and keeps unparseable ones as errors', () => {
    const rows = parsePaste('2026-10-03 NETFLIX.COM 8844 -15.49\n10/05/2026,PLANET FITNESS,-29.99\nnot a transaction');
    expect(rows[0]).toEqual({ Date: '2026-10-03', Description: 'NETFLIX.COM 8844', Amount: '-15.49' });
    expect(rows[1]).toEqual({ Date: '10/05/2026', Description: 'PLANET FITNESS', Amount: '-29.99' });
    const { rows: txs, errors } = applyMapping(rows, { ...MAPPING, transactionId: undefined });
    expect(txs).toHaveLength(2);
    expect(errors).toEqual([{ line: 3, index: 2, reason: 'Missing date' }]);
  });

  it('line numbers: pasted text is 1-based as the user sees it (13th pasted line = Line 13)', () => {
    const good = (i: number) => `2026-10-${String(i).padStart(2, '0')} SHOP ${i} -${i}.00`;
    const lines = Array.from({ length: 12 }, (_, i) => good(i + 1));
    lines.push('this line is broken');
    const { errors } = applyMapping(parsePaste(lines.join('\n')), { ...MAPPING, transactionId: undefined });
    expect(errors).toEqual([{ line: 13, index: 12, reason: 'Missing date' }]);
  });

  it('line numbers: blank lines in pasted text are counted', () => {
    const { errors } = applyMapping(parsePaste('2026-10-01 A -1.00\n\nbroken'), { ...MAPPING, transactionId: undefined });
    expect(errors[0]).toMatchObject({ line: 3, index: 1 });
  });

  it('line numbers: CSV with header — first data row is line 2 like Excel', () => {
    const rows = parseCsv('Date,Description,Amount\nbad,A,-1.00\n2026-10-02,B,-2.00\n2026-10-03,C,oops');
    const { errors } = applyMapping(rows, MAPPING);
    expect(errors).toEqual([
      { line: 2, index: 0, reason: 'Invalid date' },
      { line: 4, index: 2, reason: 'Invalid amount' },
    ]);
  });

  it('parsePaste delegates to CSV when there is a header row', () => {
    const rows = parsePaste('Date,Description,Amount\n2026-10-03,NETFLIX,-15.49');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(['Date', 'Description', 'Amount']);
  });
});

describe('suggestMapping', () => {
  it('finds standard columns', () => {
    expect(suggestMapping(['Posted Date', 'Payee', 'Amount', 'Reference Number', 'Balance', 'Account'])).toEqual({
      date: 'Posted Date',
      description: 'Payee',
      amount: 'Amount',
      transactionId: 'Reference Number',
      signConvention: 'negative_is_debit',
    });
  });
  it('handles debit/credit columns', () => {
    const m = suggestMapping(['Date', 'Description', 'Debit', 'Credit']);
    expect(m).toMatchObject({ amount: 'Credit', debitColumn: 'Debit' });
  });
  it('returns null when columns are missing', () => {
    expect(suggestMapping(['Date', 'Description'])).toBeNull();
  });
});

describe('applyMapping', () => {
  it('T-12: missing / invalid values are reported per row, rest still parsed', () => {
    const rows = [
      { Date: '2026-10-03', Description: 'NETFLIX', Amount: '-15.49' },
      { Date: '2026-13-45', Description: 'BAD DATE', Amount: '-1.00' },
      { Date: '2026-10-04', Description: 'NO AMOUNT', Amount: '' },
      { Date: '2026-10-05', Description: 'BAD AMOUNT', Amount: 'abc' },
      { Date: '2026-10-06', Description: '', Amount: '-2.00' },
    ];
    const { rows: ok, errors } = applyMapping(rows, MAPPING);
    expect(ok).toHaveLength(1);
    expect(errors).toEqual([
      { line: 3, index: 1, reason: 'Invalid date' },
      { line: 4, index: 2, reason: 'Missing amount' },
      { line: 5, index: 3, reason: 'Invalid amount' },
      { line: 6, index: 4, reason: 'Missing description' },
    ]);
    // A mapping pointing to a nonexistent column yields clear per-row errors, not a crash.
    const bad = applyMapping(rows, { ...MAPPING, amount: 'Nope' });
    expect(bad.rows).toHaveLength(0);
    expect(bad.errors.some((e) => e.reason === 'Missing amount')).toBe(true);
  });

  it('T-15: both sign conventions give the same expenses', () => {
    const neg = [
      { Date: '2026-10-03', Description: 'NETFLIX', Amount: '-15.49' },
      { Date: '2026-10-04', Description: 'PAYROLL', Amount: '3000.00' },
    ];
    const pos = [
      { Date: '2026-10-03', Description: 'NETFLIX', Amount: '15.49' },
      { Date: '2026-10-04', Description: 'PAYROLL', Amount: '-3000.00' },
    ];
    const a = applyMapping(neg, { ...MAPPING, signConvention: 'negative_is_debit' }).rows;
    const b = applyMapping(pos, { ...MAPPING, signConvention: 'positive_is_debit' }).rows;
    expect(b.map((t) => t.amountCents)).toEqual(a.map((t) => t.amountCents));
    expect(a[0].amountCents).toBe(1549);
    expect(a[1].amountCents).toBe(-300000);
    expect(analyzeTransactions(a).stats.credits).toBe(1);
  });

  it('supports separate debit/credit columns and ignores unneeded columns', () => {
    const rows = [
      { Date: '10/03/2026', Description: 'NETFLIX', Debit: '15.49', Credit: '', Balance: '999', Account: '123' },
      { Date: '10/04/2026', Description: 'PAYROLL', Debit: '', Credit: '3,000.00', Balance: '999', Account: '123' },
    ];
    const { rows: out } = applyMapping(rows, {
      date: 'Date',
      description: 'Description',
      amount: 'Credit',
      debitColumn: 'Debit',
      signConvention: 'negative_is_debit',
    });
    expect(out.map((t) => t.amountCents)).toEqual([1549, -300000]);
    expect(JSON.stringify(out)).not.toContain('999');
    expect(JSON.stringify(out)).not.toContain('123"');
  });
});

describe('detectRecurring', () => {
  it('T-01 style: 3 monthly charges -> monthly, high', () => {
    const [e] = detectRecurring(monthly('NETFLIX.COM', 1549, ['2026-08-03', '2026-09-03', '2026-10-03']));
    expect(e).toMatchObject({ merchant: 'Netflix', frequency: 'monthly', confidence: 'high', priceCents: 1549 });
    expect(e.reasons[0]).toBe('3 charges of $15.49, ~30 days apart');
    expect(e.decision).toBe('undecided');
  });

  it('2 monthly charges -> medium; weekly x2 -> low', () => {
    const [m] = detectRecurring(monthly('SPOTIFY', 1699, ['2026-09-18', '2026-10-18']));
    expect(m.confidence).toBe('medium');
    const [w] = detectRecurring(monthly('NETFLIX', 500, ['2026-10-01', '2026-10-08']));
    expect(w).toMatchObject({ frequency: 'weekly', confidence: 'low' });
  });

  it('T-04: same transaction ID twice is counted once; no-ID repeat is only flagged', () => {
    const dup = [
      tx({ id: 'A1', date: '2026-08-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'A2', date: '2026-09-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'A2', date: '2026-09-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'A3', date: '2026-10-05', merchant: 'PLANET FITNESS', cents: 2999 }),
    ];
    const r = analyzeTransactions(dup);
    expect(r.stats.excludedDuplicates).toBe(1);
    expect(r.expenses[0].reasons[0]).toBe('3 charges of $29.99, ~30 days apart');
    expect(r.expenses[0].flags).not.toContain('duplicate_candidate');

    const noId = [
      tx({ date: '2026-08-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ date: '2026-09-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ date: '2026-09-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ date: '2026-10-05', merchant: 'PLANET FITNESS', cents: 2999 }),
    ];
    const r2 = analyzeTransactions(noId);
    expect(r2.stats.excludedDuplicates).toBe(0);
    expect(r2.expenses[0].flags).toContain('duplicate_candidate');
  });

  it('T-05: refund is excluded from spend', () => {
    const txs = [
      ...monthly('NETFLIX.COM', 1549, ['2026-08-03', '2026-09-03', '2026-10-03']),
      tx({ id: 'R1', date: '2026-10-06', merchant: 'NETFLIX.COM REFUND', cents: -1549, isRefund: true }),
    ];
    const r = analyzeTransactions(txs);
    expect(r.stats.excludedRefunds).toBe(1);
    expect(r.expenses).toHaveLength(1);
    expect(r.expenses[0].priceCents).toBe(1549);
    expect(r.expenses[0].transactionIds).not.toContain('R1');
  });

  it('T-06: single $120 yearly payment is low confidence, not a proven subscription', () => {
    const [e] = detectRecurring([tx({ id: 'Y1', date: '2026-09-14', merchant: 'AAA MEMBERSHIP ANNUAL', cents: 12000 })]);
    expect(e).toMatchObject({ merchant: 'AAA', frequency: 'yearly', confidence: 'low', priceCents: 12000 });
  });

  it('T-07: grocery purchases on similar dates are not a subscription', () => {
    const groceries = monthly('TRADER JOES #552', 6475, ['2026-08-22', '2026-09-19', '2026-10-17']).map((t, i) => ({
      ...t,
      amountCents: [6475, 7108, 5891][i],
    }));
    const found = detectRecurring(groceries);
    for (const e of found) {
      expect(e.confidence).toBe('low');
      expect(e.reasons).toContain(STORE_REASON);
    }
    expect(pickReviewCandidates(found)).toHaveLength(0);
  });

  it('price change: uses latest price, flags increase', () => {
    const txs = [
      tx({ id: 'p1', date: '2026-07-03', merchant: 'NETFLIX', cents: 1549 }),
      tx({ id: 'p2', date: '2026-08-03', merchant: 'NETFLIX', cents: 1549 }),
      tx({ id: 'p3', date: '2026-09-03', merchant: 'NETFLIX', cents: 1799 }),
      tx({ id: 'p4', date: '2026-10-03', merchant: 'NETFLIX', cents: 1799 }),
    ];
    const [e] = detectRecurring(txs);
    expect(e.priceCents).toBe(1799);
    expect(e.flags).toContain('price_increase');
    expect(e.reasons).toContain('Price changed from $15.49 to $17.99');
  });

  it('stores: varying grocery prices produce no price-change reason or flag', () => {
    const txs = [
      tx({ id: 'g1', date: '2026-07-04', merchant: 'WHOLEFDS MKT 1', cents: 5000 }),
      tx({ id: 'g2', date: '2026-08-04', merchant: 'WHOLEFDS MKT 1', cents: 5100 }),
      tx({ id: 'g3', date: '2026-09-04', merchant: 'WHOLEFDS MKT 1', cents: 9000 }),
      tx({ id: 'g4', date: '2026-10-04', merchant: 'WHOLEFDS MKT 1', cents: 9100 }),
    ];
    const [e] = detectRecurring(txs);
    expect(e.flags).not.toContain('price_increase');
    expect(e.reasons.join(' ')).not.toMatch(/Price changed|Amounts vary/);
    expect(e.reasons).toContain(STORE_REASON);
    expect(e.confidence).toBe('low');
  });

  it('pickReviewCandidates never decides for the user and caps at 5', () => {
    const many: Expense[] = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      merchant: `M${i}`,
      category: 'Other',
      frequency: 'monthly',
      priceCents: 2000 + i * 100,
      confidence: 'high',
      reasons: ['x'],
      flags: [],
      transactionIds: [],
      decision: 'undecided',
      actionStatus: 'not_started',
    }));
    const picked = pickReviewCandidates(many, 10);
    expect(picked).toHaveLength(5);
    expect(picked.every((e) => e.decision === 'undecided')).toBe(true);
    expect(picked[0].priceCents).toBe(2700);
    expect(picked[0].reasons[0]).toMatch(/^Worth a review/);
    expect(many[7].reasons).toEqual(['x']); // input untouched
  });
});

describe('DEMO_TRANSACTIONS_CSV end to end', () => {
  const rows = parseCsv(DEMO_TRANSACTIONS_CSV);
  const mapping = suggestMapping(Object.keys(rows[0]))!;
  const parsed = applyMapping(rows, mapping);
  const { expenses, stats } = analyzeTransactions(parsed.rows);
  const by = (m: string) => expenses.find((e) => e.merchant === m);

  it('parses everything without errors', () => {
    expect(mapping).toMatchObject({ transactionId: 'Transaction ID' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(28);
  });

  it('finds the five services as monthly high with the right prices', () => {
    const expected: [string, number][] = [
      ['Netflix', 1549],
      ['Planet Fitness', 2999],
      ['Comcast', 7500],
      ['Spotify', 1699],
      ['iCloud', 999],
    ];
    for (const [name, cents] of expected) {
      expect(by(name), name).toMatchObject({ frequency: 'monthly', confidence: 'high', priceCents: cents });
    }
  });

  it('dedupes TX-1005, excludes the refund and payroll', () => {
    expect(stats).toEqual({ parsed: 28, excludedRefunds: 1, excludedDuplicates: 1, credits: 2 });
    expect(by('Planet Fitness')!.transactionIds.filter((id) => id === 'TX-1005')).toHaveLength(1);
    expect(by('Netflix')!.transactionIds).not.toContain('TX-1016');
    expect(expenses.some((e) => /payroll/i.test(e.merchant))).toBe(false);
  });

  it('AAA $120 is low; groceries are never a subscription', () => {
    expect(by('AAA')).toMatchObject({ confidence: 'low', priceCents: 12000 });
    for (const e of expenses.filter((x) => /Whole Foods|Trader Joe/.test(x.merchant))) {
      expect(e.confidence).toBe('low');
      expect(e.reasons).toContain(STORE_REASON);
    }
    expect(pickReviewCandidates(expenses).some((e) => /Whole Foods|Trader Joe|AAA/.test(e.merchant))).toBe(false);
  });
});

describe('performance', () => {
  it('1,000 rows parse + analyze in < 500 ms', () => {
    const lines = ['Date,Description,Amount,Transaction ID'];
    const merchants = ['NETFLIX.COM 8844', 'SPOTIFY USA', 'WHOLEFDS MKT 10234', 'ACME GYM #12', 'RANDOM SHOP 77'];
    for (let i = 0; i < 1000; i++) {
      const day = (i % 28) + 1;
      const month = ((i >> 5) % 12) + 1;
      const amt = (10 + ((i * 7) % 90)) + '.' + String((i * 13) % 100).padStart(2, '0');
      lines.push(
        `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')},${merchants[i % 5]} ${i % 40},-${amt},ID${i}`,
      );
    }
    const csv = lines.join('\n');
    const t0 = performance.now();
    const raw = parseCsv(csv);
    const { rows } = applyMapping(raw, suggestMapping(Object.keys(raw[0]))!);
    const { stats } = analyzeTransactions(rows);
    const ms = performance.now() - t0;
    expect(stats.parsed).toBe(1000);
    expect(ms).toBeLessThan(500);
  });
});
