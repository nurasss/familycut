import { describe, expect, it } from 'vitest';
import { DEMO_EXPENSES, DEMO_GOAL } from '@/lib/fixtures/miller';
import { formatUsd } from '@/lib/format';
import type { Expense } from '@/lib/types';
import { annualCents, computeTotals } from './money';

function exp(p: Partial<Expense>): Expense {
  return {
    id: 'x',
    merchant: 'X',
    category: 'Other',
    frequency: 'monthly',
    priceCents: 0,
    confidence: 'manual',
    reasons: [],
    flags: [],
    transactionIds: [],
    decision: 'undecided',
    actionStatus: 'not_started',
    ...p,
  };
}

describe('money', () => {
  it('T-01: Netflix $15.49 monthly = $185.88/year', () => {
    expect(annualCents(1549, 'monthly')).toBe(18588);
    const t = computeTotals([exp({ priceCents: 1549 })]);
    expect(t.recurringAnnualCents).toBe(18588);
    expect(formatUsd(t.recurringAnnualCents)).toBe('$185.88');
  });

  it('T-02: Internet $75 → target $60 negotiate = $180 potential', () => {
    const t = computeTotals([exp({ priceCents: 7500, decision: 'negotiate', targetPriceCents: 6000 })]);
    expect(t.potentialAnnualCents).toBe(18000);
  });

  it('T-03: Gym $30 Keep = $0 potential', () => {
    const t = computeTotals([exp({ priceCents: 3000, decision: 'keep' })]);
    expect(t.potentialAnnualCents).toBe(0);
    expect(t.recurringAnnualCents).toBe(36000);
  });

  it('T-08: Cut without completed = potential only, reported 0', () => {
    const t = computeTotals([exp({ priceCents: 2999, decision: 'cut', actionStatus: 'attempted' })]);
    expect(t.potentialAnnualCents).toBe(35988);
    expect(t.reportedAnnualCents).toBe(0);
  });

  it('T-09: completed Internet $75 → $60 = $180 reported', () => {
    const t = computeTotals([
      exp({
        priceCents: 7500,
        decision: 'negotiate',
        targetPriceCents: 6000,
        actionStatus: 'completed',
        reportedNewPriceCents: 6000,
      }),
    ]);
    expect(t.reportedAnnualCents).toBe(18000);
  });

  it('completed Cut counts new price as 0', () => {
    const t = computeTotals([exp({ priceCents: 2999, decision: 'cut', actionStatus: 'completed' })]);
    expect(t.reportedAnnualCents).toBe(35988);
  });

  it('T-16: Negotiate without target price = no invented savings', () => {
    const t = computeTotals([exp({ priceCents: 7500, decision: 'negotiate' })]);
    expect(t.potentialAnnualCents).toBe(0);
    expect(t.reportedAnnualCents).toBe(0);
  });

  it('negotiate completed without reportedNewPrice does not count', () => {
    const t = computeTotals([
      exp({ priceCents: 7500, decision: 'negotiate', targetPriceCents: 6000, actionStatus: 'completed' }),
    ]);
    expect(t.reportedAnnualCents).toBe(0);
  });

  it('unknown frequency and not_recurring are excluded from recurring', () => {
    const t = computeTotals([
      exp({ priceCents: 1000, frequency: 'unknown', decision: 'cut' }),
      exp({ priceCents: 1000, decision: 'not_recurring' }),
    ]);
    expect(t.recurringAnnualCents).toBe(0);
    expect(t.potentialAnnualCents).toBe(0);
  });

  it('multipliers: weekly 52, quarterly 4, yearly 1', () => {
    expect(annualCents(100, 'weekly')).toBe(5200);
    expect(annualCents(100, 'quarterly')).toBe(400);
    expect(annualCents(100, 'yearly')).toBe(100);
    expect(annualCents(100, 'unknown')).toBe(0);
  });

  it('demo family: potential = 72576 cents, planned goal ≈ 48%', () => {
    const t = computeTotals(DEMO_EXPENSES, DEMO_GOAL);
    expect(t.potentialAnnualCents).toBe(72576);
    expect(Math.round(t.plannedGoalPct)).toBe(48);
    expect(t.reportedAnnualCents).toBe(0);
    expect(t.reportedGoalPct).toBe(0);
  });

  it('goal pct is capped at 100 and 0 without goal', () => {
    const e = [exp({ priceCents: 100000, decision: 'cut' })];
    expect(computeTotals(e, { name: 'g', targetCents: 1000 }).plannedGoalPct).toBe(100);
    expect(computeTotals(e).plannedGoalPct).toBe(0);
  });

  it('formatUsd', () => {
    expect(formatUsd(123456)).toBe('$1,234.56');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(0)).toBe('$0.00');
  });
});
