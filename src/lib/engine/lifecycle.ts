// Decision / action-execution lifecycle (TZ §8.1–8.2). Pure functions shared by every store mutation,
// so no patch can bypass the invariants.
//
// Rule: the execution state (actionStatus, reportedNewPriceCents, completedAt) belongs to ONE concrete
// action applied to ONE baseline (decision + original price + frequency). When the action or the baseline
// really changes, the old confirmation no longer describes reality and is dropped; the user confirms again.
// A new target price does not change what was already achieved, so it never touches the reported result.
// The reset is unconditional: execution fields carried in the same patch are NOT a confirmation of the new
// action. The user confirms the new action with a separate, later call (setActionStatus).
import type { ActionStatus, Decision, Expense } from '@/lib/types';

export type ExpensePatch = Partial<Omit<Expense, 'id'>>;

const isoNow = () => new Date().toISOString();

/** Only Cut and Negotiate are actions with an outcome; every other decision carries no execution state. */
const isActionable = (d: Decision): boolean => d === 'cut' || d === 'negotiate';

/** Same expense with no confirmed or attempted execution. */
export function resetExecution(expense: Expense): Expense {
  const next: Expense = { ...expense, actionStatus: 'not_started' };
  delete next.reportedNewPriceCents;
  delete next.completedAt;
  return next;
}

/** Status transition from the action screen: completed keeps the reported price, anything else clears it. */
export function applyActionStatus(
  expense: Expense,
  status: ActionStatus,
  reportedNewPriceCents?: number,
  now: string = isoNow(),
): Expense {
  // Keep / Not recurring / undecided have no action to execute: they never get attempted or completed.
  if (!isActionable(expense.decision) && status !== 'not_started') return expense;
  const base = resetExecution(expense);
  if (status !== 'completed') return { ...base, actionStatus: status };
  return {
    ...base,
    actionStatus: 'completed',
    ...(reportedNewPriceCents !== undefined ? { reportedNewPriceCents } : {}),
    completedAt: now,
  };
}

/**
 * Apply a partial update to an expense, enforcing the lifecycle:
 * - a changed decision, original price or frequency ALWAYS resets the execution state, whatever execution
 *   fields the same patch carries (a new action is confirmed by a separate setActionStatus call);
 * - the same value written again is not a change (confirmation survives);
 * - target price and other fields never touch the execution state;
 * - Keep / Not recurring / undecided never hold attempted / completed, reported price or date;
 * - reported price / completedAt only exist together with "completed", and a completed expense always has a date.
 */
export function applyExpensePatch(expense: Expense, patch: ExpensePatch, now: string = isoNow()): Expense {
  let next: Expense = { ...expense, ...patch, id: expense.id };

  const baselineChanged =
    next.decision !== expense.decision ||
    next.priceCents !== expense.priceCents ||
    next.frequency !== expense.frequency;
  if (baselineChanged || !isActionable(next.decision)) return resetExecution(next);

  if (next.actionStatus !== 'completed') {
    if (next.reportedNewPriceCents !== undefined || next.completedAt !== undefined) {
      next = { ...next };
      delete next.reportedNewPriceCents;
      delete next.completedAt;
    }
  } else if (next.completedAt === undefined) {
    next = { ...next, completedAt: now };
  }
  return next;
}

/** Decision change. Setting the decision the expense already has returns it untouched. */
export function applyDecision(expense: Expense, decision: Decision, now?: string): Expense {
  if (expense.decision === decision) return expense;
  return applyExpensePatch(expense, { decision }, now);
}

/**
 * Persisted sessions written before the lifecycle rule may carry an execution state that belongs to no
 * action at all (Keep / Not recurring / undecided never have one). Drop only that; everything else, including
 * completed Cut / Negotiate with their reported prices, is user data and is kept as is.
 */
export function sanitizeExpense(expense: Expense): Expense {
  const hasExecution =
    expense.actionStatus !== 'not_started' ||
    expense.reportedNewPriceCents !== undefined ||
    expense.completedAt !== undefined;
  if (!isActionable(expense.decision) && hasExecution) return resetExecution(expense);
  if (expense.actionStatus !== 'completed' && (expense.reportedNewPriceCents !== undefined || expense.completedAt !== undefined)) {
    return applyExpensePatch(expense, {});
  }
  return expense;
}
