import type { Expense, FamilyGoal, Frequency, Totals } from '@/lib/types';

/** TZ §8.1. 'unknown' contributes nothing. */
export const MULTIPLIER: Record<Frequency, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
  unknown: 0,
};

export function annualCents(priceCents: number, freq: Frequency): number {
  return priceCents * MULTIPLIER[freq];
}

function goalPct(cents: number, goal?: FamilyGoal): number {
  if (!goal || goal.targetCents <= 0) return 0;
  return Math.min(100, (cents / goal.targetCents) * 100);
}

/** TZ §8.1, §8.2, §8.4. Integer cents only; percentages are plain numbers. */
export function computeTotals(expenses: Expense[], goal?: FamilyGoal): Totals {
  let recurring = 0;
  let potential = 0;
  let reported = 0;

  for (const e of expenses) {
    if (e.decision === 'not_recurring' || e.frequency === 'unknown') continue;
    // Recurring = confirmed by the user, or detected with enough confidence (TZ §8.1).
    const confirmed = e.decision === 'keep' || e.decision === 'cut' || e.decision === 'negotiate';
    const trusted = e.confidence !== 'low';
    if (!confirmed && !trusted) continue;
    const mult = MULTIPLIER[e.frequency];
    recurring += e.priceCents * mult;

    if (e.decision === 'cut') {
      potential += e.priceCents * mult;
    } else if (e.decision === 'negotiate' && e.targetPriceCents !== undefined) {
      potential += Math.max(0, e.priceCents - e.targetPriceCents) * mult;
    }

    if (e.actionStatus === 'completed') {
      if (e.decision === 'cut') {
        reported += Math.max(0, e.priceCents - (e.reportedNewPriceCents ?? 0)) * mult;
      } else if (e.decision === 'negotiate' && e.reportedNewPriceCents !== undefined) {
        reported += Math.max(0, e.priceCents - e.reportedNewPriceCents) * mult;
      }
    }
  }

  return {
    recurringAnnualCents: recurring,
    potentialAnnualCents: potential,
    reportedAnnualCents: reported,
    plannedGoalPct: goalPct(potential, goal),
    reportedGoalPct: goalPct(reported, goal),
  };
}
