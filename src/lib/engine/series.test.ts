// Regression tests for F01 (independent services must not merge) and F06 (honest price-change evidence).
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/types';
import { analyzeTransactions } from './detect';
import { computeTotals } from './money';
import { normalizeMerchant } from './normalize';

function tx(p: { id: string; date: string; merchant: string; cents: number }): Transaction {
  return {
    id: p.id,
    date: p.date,
    merchantRaw: p.merchant,
    merchantNormalized: normalizeMerchant(p.merchant),
    amountCents: p.cents,
    isRefund: false,
    currency: 'USD',
  };
}

const DATES = ['2026-08-03', '2026-09-03', '2026-10-03'];

/** Two parallel services, three months, six distinct bank IDs. */
function adobeTwoProducts(a = 'ADOBE PHOTOSHOP', b = 'ADOBE ACROBAT'): Transaction[] {
  return DATES.flatMap((date, i) => [
    tx({ id: `P${i}`, date, merchant: a, cents: 999 }),
    tx({ id: `A${i}`, date, merchant: b, cents: 1999 }),
  ]);
}

/** Order-independent summary of what the detector concluded. */
const summary = (txs: Transaction[]) =>
  analyzeTransactions(txs)
    .expenses.map((e) => ({
      merchant: e.merchant,
      price: e.priceCents,
      freq: e.frequency,
      confidence: e.confidence,
      reasons: e.reasons,
      flags: [...e.flags].sort(),
      ids: [...e.transactionIds].sort(),
    }))
    .sort((x, y) => x.price - y.price || x.merchant.localeCompare(y.merchant));

// Deterministic pseudo-random permutation (no Math.random in tests).
function permute<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('F01 independent services of one provider', () => {
  it('named products (Photoshop + Acrobat) stay two services: $359.76/year recurring, nothing auto-cut', () => {
    const { expenses } = analyzeTransactions(adobeTwoProducts());
    expect(expenses.map((e) => [e.merchant, e.priceCents, e.frequency, e.confidence]).sort()).toEqual([
      ['Adobe Acrobat', 1999, 'monthly', 'high'],
      ['Adobe Photoshop', 999, 'monthly', 'high'],
    ]);
    expect(expenses.every((e) => e.decision === 'undecided')).toBe(true);
    const totals = computeTotals(expenses);
    expect(totals.recurringAnnualCents).toBe(35976);
    expect(totals.potentialAnnualCents).toBe(0);
  });

  it('same provider name for both (cannot tell the products apart): still two series, honest evidence, same total', () => {
    const txs = adobeTwoProducts('ADOBE *1111111', 'ADOBE *2222222');
    expect(new Set(txs.map((t) => t.merchantNormalized))).toEqual(new Set(['Adobe']));
    const { expenses } = analyzeTransactions(txs);
    expect(expenses).toHaveLength(2);
    expect(expenses.map((e) => e.priceCents).sort((a, b) => a - b)).toEqual([999, 1999]);
    for (const e of expenses) {
      expect(e.merchant).toBe('Adobe'); // product is not invented
      expect(e.frequency).toBe('monthly');
      expect(e.confidence).toBe('medium'); // 3 charges would be high, ambiguity lowers it one level
      expect(e.reasons.join(' ')).toMatch(/same day as another Adobe charge .* kept as a separate service, not merged/);
      expect(e.flags).not.toContain('duplicate_candidate');
    }
    // Medium confidence is still counted: the spend is not silently dropped.
    expect(computeTotals(expenses).recurringAnnualCents).toBe(35976);
  });

  it('row order does not change the result (reverse + several shuffles)', () => {
    for (const [a, b] of [
      ['ADOBE PHOTOSHOP', 'ADOBE ACROBAT'],
      ['ADOBE *1111111', 'ADOBE *2222222'],
    ]) {
      const txs = adobeTwoProducts(a, b);
      const base = summary(txs);
      expect(summary([...txs].reverse())).toEqual(base);
      for (let seed = 1; seed <= 8; seed++) expect(summary(permute(txs, seed))).toEqual(base);
    }
  });

  it('without bank IDs the two same-day charges are both kept (nothing deleted automatically)', () => {
    const noIds = adobeTwoProducts('ADOBE *1111111', 'ADOBE *2222222').map((t, i) => ({ ...t, id: `row-${i + 2}` }));
    const { expenses, stats } = analyzeTransactions(noIds);
    expect(stats.excludedDuplicates).toBe(0);
    expect(expenses).toHaveLength(2);
    expect(expenses.flatMap((e) => e.transactionIds)).toHaveLength(6);
  });

  it('two identical no-ID charges on one day are only flagged, never removed, and not called a duplicate for certain', () => {
    const txs = [
      tx({ id: 'row-2', date: '2026-08-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'row-3', date: '2026-08-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'row-4', date: '2026-09-05', merchant: 'PLANET FITNESS', cents: 2999 }),
      tx({ id: 'row-5', date: '2026-10-05', merchant: 'PLANET FITNESS', cents: 2999 }),
    ];
    const { expenses, stats } = analyzeTransactions(txs);
    expect(stats.excludedDuplicates).toBe(0);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].transactionIds).toHaveLength(4);
    expect(expenses[0].flags).toContain('duplicate_candidate');
    expect(expenses[0].reasons.join(' ')).toContain('possible duplicate (or two separate accounts)');
    expect(expenses[0].priceCents).toBe(2999);
  });

  it('exact-ID dedup still works next to a parallel service', () => {
    const txs = [...adobeTwoProducts(), tx({ id: 'P1', date: '2026-09-03', merchant: 'ADOBE PHOTOSHOP', cents: 999 })];
    const { expenses, stats } = analyzeTransactions(txs);
    expect(stats.excludedDuplicates).toBe(1);
    expect(expenses).toHaveLength(2);
    expect(computeTotals(expenses).recurringAnnualCents).toBe(35976);
  });

  it('services billed on different days of the month stay separate too', () => {
    const txs = DATES.flatMap((date, i) => [
      tx({ id: `P${i}`, date, merchant: 'ADOBE *1', cents: 999 }),
      tx({ id: `A${i}`, date: date.replace('-03', '-17'), merchant: 'ADOBE *2', cents: 1999 }),
    ]);
    const { expenses } = analyzeTransactions(txs);
    expect(expenses.map((e) => e.priceCents).sort((a, b) => a - b)).toEqual([999, 1999]);
    expect(computeTotals(expenses).recurringAnnualCents).toBe(35976);
  });

  it('YouTube TV / Music / Premium are different services', () => {
    expect(normalizeMerchant('GOOGLE *YOUTUBE TV')).toBe('YouTube TV');
    expect(normalizeMerchant('GOOGLE *YOUTUBE MUSIC')).toBe('YouTube Music');
    expect(normalizeMerchant('GOOGLE *YOUTUBE PREMIUM')).toBe('YouTube Premium');
    expect(normalizeMerchant('GOOGLE *YOUTUBEPREMIUM')).toBe('YouTube Premium');
    // Not guessing a product that the description does not name.
    expect(normalizeMerchant('GOOGLE *YOUTUBE')).toBe('YouTube');
    const txs = DATES.flatMap((date, i) => [
      tx({ id: `tv${i}`, date, merchant: 'GOOGLE *YOUTUBE TV', cents: 8299 }),
      tx({ id: `mu${i}`, date, merchant: 'GOOGLE *YOUTUBE MUSIC', cents: 1099 }),
      tx({ id: `pr${i}`, date, merchant: 'GOOGLE *YOUTUBE PREMIUM', cents: 1399 }),
    ]);
    const { expenses } = analyzeTransactions(txs);
    expect(expenses.map((e) => e.merchant).sort()).toEqual(['YouTube Music', 'YouTube Premium', 'YouTube TV']);
    expect(computeTotals(expenses).recurringAnnualCents).toBe((8299 + 1099 + 1399) * 12);
  });

  it('other Adobe products are named; unnamed Adobe stays plain "Adobe"', () => {
    expect(normalizeMerchant('ADOBE *LIGHTROOM')).toBe('Adobe Lightroom');
    expect(normalizeMerchant('ADOBE *CREATIVE CLOUD')).toBe('Adobe');
  });
});

describe('F01/F06 a real price change stays one series', () => {
  const netflix = (cents: number[]) =>
    cents.map((c, i) => tx({ id: `n${i}`, date: ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'][i + (4 - cents.length)], merchant: 'NETFLIX.COM', cents: c }));

  it('F06: $15.49, $15.49, $16.49 -> latest price, price change, truthful evidence', () => {
    const [e, ...rest] = analyzeTransactions(netflix([1549, 1549, 1649])).expenses;
    expect(rest).toHaveLength(0);
    expect(e.priceCents).toBe(1649);
    expect(e.frequency).toBe('monthly');
    expect(e.flags).toContain('price_increase');
    expect(e.reasons).toContain('Price changed from $15.49 to $16.49');
    expect(e.reasons).toContain('Amounts seen: 2 × $15.49, then 1 × $16.49');
    expect(e.reasons.join(' ')).not.toMatch(/3 charges of \$16\.49/);
    expect(e.confidence).toBe('high'); // the series is certain; only the amount changed
  });

  it('a price decrease is reported without the increase flag', () => {
    const [e] = analyzeTransactions(netflix([1799, 1799, 1549])).expenses;
    expect(e.priceCents).toBe(1549);
    expect(e.reasons).toContain('Price changed from $17.99 to $15.49');
    expect(e.flags).not.toContain('price_increase');
  });

  it('two charges with a small change are still a price change, not "2 charges of the last price"', () => {
    const [e] = analyzeTransactions(netflix([1549, 1649])).expenses;
    expect(e.reasons).toContain('Price changed from $15.49 to $16.49');
    expect(e.confidence).toBe('medium');
  });

  it('tiny rounding noise (<=1%) is not reported as a price change', () => {
    const [e] = analyzeTransactions(netflix([7500, 7510, 7490])).expenses;
    expect(e.reasons.join(' ')).not.toMatch(/Price changed/);
    expect(e.reasons[0]).toBe('3 charges of $74.90–$75.10, ~30 days apart');
    expect(e.flags).toEqual([]);
  });

  it('a large jump is reported but lowers confidence and says it may be a different plan', () => {
    const [e] = analyzeTransactions(netflix([999, 999, 1999, 1999])).expenses;
    expect(e.reasons).toContain('Price changed from $9.99 to $19.99');
    expect(e.reasons.join(' ')).toContain('could also be a different plan or a separate service');
    expect(e.confidence).toBe('medium');
    expect(e.priceCents).toBe(1999);
  });

  it('price change of one stream does not merge it with a parallel stream', () => {
    const txs = [
      ...[999, 999, 1099].map((c, i) => tx({ id: `a${i}`, date: DATES[i], merchant: 'ADOBE *1', cents: c })),
      ...[1999, 1999, 1999].map((c, i) => tx({ id: `b${i}`, date: DATES[i], merchant: 'ADOBE *2', cents: c })),
    ];
    const { expenses } = analyzeTransactions(txs);
    expect(expenses.map((e) => e.priceCents).sort((a, b) => a - b)).toEqual([1099, 1999]);
    const changed = expenses.find((e) => e.priceCents === 1099)!;
    expect(changed.reasons).toContain('Price changed from $9.99 to $10.99');
    expect(expenses.find((e) => e.priceCents === 1999)!.reasons.join(' ')).not.toMatch(/Price changed/);
    expect(summary([...txs].reverse())).toEqual(summary(txs));
  });
});

const iso = (month: number, day: number) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Two services of one provider (same normalized name), each billed monthly on its own day. */
function twoDayStreams(
  dayA: number,
  amountsA: number[],
  dayB: number,
  amountsB: number[],
  months = [8, 9, 10],
): Transaction[] {
  return months.flatMap((m, i) => [
    tx({ id: `A${i}`, date: iso(m, dayA), merchant: 'ADOBE *1', cents: amountsA[i] }),
    tx({ id: `B${i}`, date: iso(m, dayB), merchant: 'ADOBE *2', cents: amountsB[i] }),
  ]);
}

const monthlyTwo = (txs: Transaction[], recurring: number) => {
  const { expenses } = analyzeTransactions(txs);
  expect(expenses).toHaveLength(2);
  for (const e of expenses) {
    expect(e.frequency).toBe('monthly');
    expect(e.confidence).not.toBe('low');
    expect(e.flags).not.toContain('duplicate_candidate');
  }
  expect(computeTotals(expenses).recurringAnnualCents).toBe(recurring);
  return expenses;
};

describe('W1B1 two monthly services billed days apart (cadence chosen from the whole history)', () => {
  it('the reviewed case: $9.99 on the 3rd and $19.99 on the 10th -> two monthly series, $359.76/year', () => {
    const exps = monthlyTwo(twoDayStreams(3, [999, 999, 999], 10, [1999, 1999, 1999]), 35976);
    expect(exps.map((e) => e.priceCents).sort((a, b) => a - b)).toEqual([999, 1999]);
    expect(exps.every((e) => e.confidence === 'high')).toBe(true);
    expect(exps.every((e) => e.reasons.every((r) => !/Price changed/.test(r)))).toBe(true);
  });

  it.each([1, 2, 5, 6, 7, 8, 9, 14])('billing days %i apart, either service first', (gap) => {
    monthlyTwo(twoDayStreams(3, [999, 999, 999], 3 + gap, [1999, 1999, 1999]), 35976);
    monthlyTwo(twoDayStreams(12, [999, 999, 999], 12 - gap, [1999, 1999, 1999]), 35976);
  });

  it('shuffled and reversed rows give the same result for gaps 6, 7 and 8', () => {
    for (const gap of [6, 7, 8]) {
      const txs = twoDayStreams(3, [999, 999, 999], 3 + gap, [1999, 1999, 1999]);
      const base = summary(txs);
      expect(base).toHaveLength(2);
      expect(summary([...txs].reverse())).toEqual(base);
      for (let seed = 1; seed <= 6; seed++) expect(summary(permute(txs, seed + gap))).toEqual(base);
    }
  });

  it('close prices ($9.99 and $10.49) a week apart stay two services', () => {
    monthlyTwo(twoDayStreams(3, [999, 999, 999], 10, [1049, 1049, 1049]), (999 + 1049) * 12);
    monthlyTwo(twoDayStreams(10, [1049, 1049, 1049], 3, [999, 999, 999]), (999 + 1049) * 12);
  });

  it('close prices that drift by cents each month still stay two monthly services', () => {
    monthlyTwo(twoDayStreams(3, [999, 1009, 989], 10, [1049, 1039, 1059]), (989 + 1059) * 12);
  });

  it('identical prices on different days are two monthly services, not weekly pairs', () => {
    monthlyTwo(twoDayStreams(3, [999, 999, 999], 10, [999, 999, 999]), 999 * 24);
    monthlyTwo(twoDayStreams(3, [999, 999, 999], 9, [999, 999, 999]), 999 * 24);
  });

  it('only two months of history: still two monthly series (medium), not three weekly ones', () => {
    const exps = monthlyTwo(twoDayStreams(3, [999, 999], 10, [1999, 1999], [8, 9]), 35976);
    expect(exps.every((e) => e.confidence === 'medium')).toBe(true);
  });

  it('a second service that starts a month later is not glued to the first one', () => {
    const txs = [
      ...[8, 9, 10].map((m, i) => tx({ id: `A${i}`, date: iso(m, 3), merchant: 'ADOBE *1', cents: 999 })),
      ...[9, 10, 11].map((m, i) => tx({ id: `B${i}`, date: iso(m, 10), merchant: 'ADOBE *2', cents: 1999 })),
    ];
    const { expenses } = analyzeTransactions(txs);
    expect(expenses.map((e) => [e.priceCents, e.frequency]).sort()).toEqual([[1999, 'monthly'], [999, 'monthly']]);
  });

  it('a real weekly price change is still one weekly series with a price change', () => {
    const dates = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'];
    const txs = dates.map((date, i) => tx({ id: `w${i}`, date, merchant: 'ACME PRESS', cents: i < 3 ? 999 : 1199 }));
    const { expenses } = analyzeTransactions(txs);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ frequency: 'weekly', priceCents: 1199 });
    expect(expenses[0].reasons).toContain('Price changed from $9.99 to $11.99');
  });

  it('a real monthly price change next to an unrelated weekly-looking neighbour is still one series', () => {
    const txs = [
      ...[7, 8, 9, 10].map((m, i) => tx({ id: `n${i}`, date: iso(m, 3), merchant: 'NETFLIX.COM', cents: i < 2 ? 1549 : 1799 })),
      ...[7, 8, 9, 10].map((m, i) => tx({ id: `s${i}`, date: iso(m, 10), merchant: 'SPOTIFY USA', cents: 1699 })),
    ];
    const { expenses } = analyzeTransactions(txs);
    expect(expenses).toHaveLength(2);
    const nf = expenses.find((e) => e.merchant === 'Netflix')!;
    expect(nf).toMatchObject({ priceCents: 1799, frequency: 'monthly', confidence: 'high' });
    expect(nf.reasons).toContain('Price changed from $15.49 to $17.99');
  });

  it('two lone charges a week apart keep the old reading: one weekly price change, low confidence', () => {
    const txs = [
      tx({ id: 'a', date: '2026-08-03', merchant: 'ADOBE *1', cents: 999 }),
      tx({ id: 'b', date: '2026-08-10', merchant: 'ADOBE *2', cents: 1999 }),
    ];
    const { expenses } = analyzeTransactions(txs);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ frequency: 'weekly', confidence: 'low' });
  });
});

describe('unchanged behaviour next to the new series builder', () => {
  it('refund is still excluded, a grocery run is still not a subscription, a single annual payment is low', () => {
    const txs = [
      ...DATES.map((date, i) => tx({ id: `n${i}`, date, merchant: 'NETFLIX.COM', cents: 1549 })),
      { ...tx({ id: 'R1', date: '2026-10-06', merchant: 'NETFLIX.COM REFUND', cents: -1549 }), isRefund: true },
      tx({ id: 'Y1', date: '2026-09-14', merchant: 'AAA MEMBERSHIP ANNUAL', cents: 12000 }),
      ...['2026-08-22', '2026-09-19', '2026-10-17'].map((date, i) =>
        tx({ id: `g${i}`, date, merchant: 'TRADER JOES #552', cents: [6475, 7108, 5891][i] }),
      ),
    ];
    const { expenses, stats } = analyzeTransactions(txs);
    expect(stats.excludedRefunds).toBe(1);
    expect(expenses.find((e) => e.merchant === 'Netflix')).toMatchObject({ priceCents: 1549, confidence: 'high' });
    expect(expenses.find((e) => e.merchant === 'AAA')).toMatchObject({ frequency: 'yearly', confidence: 'low' });
    for (const e of expenses.filter((x) => x.merchant === "Trader Joe's")) expect(e.confidence).toBe('low');
  });
});
