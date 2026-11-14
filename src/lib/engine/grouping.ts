// Manual transaction grouping types and pure preview operations (F09).
// Browser-safe, pure functions, no persistence or server-side dependencies.
import type { Frequency } from '@/lib/types';

export const MAX_GROUPS = 200;
export const MAX_GROUP_NAME_LENGTH = 80;

const MAX_GROUP_ROWS = 10_000;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

export type GroupMode = 'split' | 'merge';

/** Ambiguity that the user must explicitly confirm before applying a group. */
export type AmbiguityKind = 'large_price_change';

export type GroupAssignment = Readonly<{
  /** Opaque local identifier within one import preview ("g-1"). Never persisted or sent to the server. */
  groupId: string;
  mode: GroupMode;
  /** Non-negative unique rawIndices of source preview rows. A row belongs to at most one assignment. */
  rawIndices: readonly number[];
  /** Optional result label (normalized via normalizeGroupName). */
  name?: string;
  /** Confirmed ambiguity kinds; valid only when confirmedFor matches the current proposalKey. */
  confirmed?: readonly AmbiguityKind[];
  /** Exact key of the proposal shown to the user when confirmed. */
  confirmedFor?: string;
}>;

export type GroupIssueCode =
  | 'invalid_group'
  | 'duplicate_group'
  | 'too_few_rows'
  | 'unknown_row'
  | 'row_excluded'
  | 'row_in_other_group'
  | 'invalid_name'
  | 'mixed_periods'
  | 'overlapping_services'
  | 'needs_confirmation'
  | 'amount_too_large'
  | 'no_expense';

export type GroupIssue = {
  code: GroupIssueCode;
  severity: 'info' | 'warning' | 'error';
  /** Short user-facing English message (TZ NFR-08). Never includes raw transaction descriptions. */
  message: string;
  rawIndices?: number[];
};

export type GroupStatus = 'applied' | 'needs_confirmation' | 'rejected' | 'inactive';

/** Preview of the resulting expense used to prompt confirmation before applying. Money is integer cents. */
export type GroupProposal = {
  /** Deterministic revision key; independent of random Expense.id, newId, timestamps, or confirmed state. */
  proposalKey: string;
  merchant: string;
  priceCents: number;
  frequency: Frequency;
  annualCents: number;
  chargeCount: number;
  partCount: number;
  gapDays: number[];
  requires: AmbiguityKind[];
};

export type GroupReport = {
  groupId: string;
  status: GroupStatus;
  /** Sorted rawIndices of eligible rows that entered this group's analysis. */
  activeRawIndices: number[];
  ignoredRawIndices: { rawIndex: number; reason: 'unknown_row' | 'row_excluded' | 'row_in_other_group' }[];
  issues: GroupIssue[];
  /** Expense ids created from this assignment (empty unless applied and >= 1 expense produced). */
  expenseIds: string[];
  proposal?: GroupProposal;
};

/** Membership link between a generated expense and the source preview rows that produced it. */
export type ExpenseSource = {
  expenseId: string;
  /** Sorted sourceIndex values of member transactions. Each sourceIndex belongs to at most one expense. */
  sourceIndices: number[];
  /** Set when the expense was produced by a manual group assignment. */
  groupId?: string;
};

export type GroupOp =
  | { type: 'split'; rawIndices: readonly number[]; name?: string }
  | { type: 'merge'; rawIndices: readonly number[]; name?: string }
  | { type: 'confirm'; groupId: string; kinds: readonly AmbiguityKind[]; proposalKey: string }
  | { type: 'undo'; groupId: string }
  | { type: 'clear' };

export type GroupOpError =
  | 'no_rows'
  | 'too_few_rows'
  | 'too_many_rows'
  | 'invalid_index'
  | 'invalid_name'
  | 'unknown_group'
  | 'too_many_groups'
  | 'invalid_confirmation';

export type GroupOpResult =
  | {
      ok: true;
      assignments: GroupAssignment[];
      /** Created or updated group id (for split / merge / confirm). */
      groupId?: string;
      /** Group ids removed because rows were transferred out, emptied, or undone/cleared. */
      removedGroupIds: string[];
    }
  | { ok: false; error: GroupOpError; message: string };

const VALID_AMBIGUITIES = new Set<AmbiguityKind>(['large_price_change']);

function failOp(error: GroupOpError, message: string): GroupOpResult {
  return { ok: false, error, message };
}

function nextFreeGroupId(assignments: readonly GroupAssignment[]): string {
  const used = new Set(assignments.map((a) => a.groupId));
  let n = 1;
  while (used.has(`g-${n}`)) n++;
  return `g-${n}`;
}

/** Trim and collapse internal whitespace; accept 1..80 chars with no control characters, else null. */
export function normalizeGroupName(input: string): string | null {
  if (typeof input !== 'string') return null;
  if (CONTROL_CHAR_RE.test(input)) return null;
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > MAX_GROUP_NAME_LENGTH) return null;
  return normalized;
}

/**
 * Pure state transition over manual group assignments. Never mutates inputs.
 * Default `makeGroupId` allocates `"g-<n>"` for the smallest unused positive integer `n`.
 */
export function applyGroupOp(
  assignments: readonly GroupAssignment[],
  op: GroupOp,
  makeGroupId?: () => string,
): GroupOpResult {
  if (op.type === 'clear') {
    return {
      ok: true,
      assignments: [],
      removedGroupIds: assignments.map((a) => a.groupId),
    };
  }

  if (op.type === 'undo') {
    const exists = assignments.some((a) => a.groupId === op.groupId);
    if (!exists) return failOp('unknown_group', 'Group not found.');
    return {
      ok: true,
      assignments: assignments.filter((a) => a.groupId !== op.groupId),
      removedGroupIds: [op.groupId],
    };
  }

  if (op.type === 'confirm') {
    const idx = assignments.findIndex((a) => a.groupId === op.groupId);
    if (idx < 0) return failOp('unknown_group', 'Group not found.');
    if (typeof op.proposalKey !== 'string' || op.proposalKey.trim().length === 0) {
      return failOp('invalid_confirmation', 'Confirmation requires a valid proposal key.');
    }
    if (!Array.isArray(op.kinds) || op.kinds.length === 0 || op.kinds.some((k) => !VALID_AMBIGUITIES.has(k))) {
      return failOp('invalid_confirmation', 'Confirmation requires at least one valid ambiguity kind.');
    }
    const kinds = [...new Set(op.kinds)];
    const target = assignments[idx];
    const updated: GroupAssignment = {
      groupId: target.groupId,
      mode: target.mode,
      rawIndices: [...target.rawIndices],
      ...(target.name !== undefined ? { name: target.name } : {}),
      confirmed: kinds,
      confirmedFor: op.proposalKey,
    };
    const next = assignments.map((a, i) => (i === idx ? updated : a));
    return {
      ok: true,
      assignments: next,
      groupId: op.groupId,
      removedGroupIds: [],
    };
  }

  // split | merge
  if (!Array.isArray(op.rawIndices)) {
    return failOp('invalid_index', 'Row indices must be an array.');
  }
  if (op.rawIndices.length === 0) {
    return failOp('no_rows', 'Select at least one row.');
  }
  const unique = new Set<number>();
  for (const idx of op.rawIndices) {
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || !Number.isSafeInteger(idx)) {
      return failOp('invalid_index', 'Row indices must be non-negative integers.');
    }
    unique.add(idx);
    if (unique.size > MAX_GROUP_ROWS) {
      return failOp('too_many_rows', `Too many rows selected (max ${MAX_GROUP_ROWS.toLocaleString('en-US')}).`);
    }
  }
  const uniqueSorted = [...unique].sort((a, b) => a - b);
  if (op.type === 'merge' && uniqueSorted.length < 2) {
    return failOp('too_few_rows', 'Select at least 2 rows to merge into one service.');
  }

  let cleanName: string | undefined;
  if (op.name !== undefined) {
    const normalized = normalizeGroupName(op.name);
    if (normalized === null) {
      return failOp('invalid_name', `Group name must be 1–${MAX_GROUP_NAME_LENGTH} characters without control characters.`);
    }
    cleanName = normalized;
  }

  const taken = unique;
  const next: GroupAssignment[] = [];
  const removedGroupIds: string[] = [];

  for (const a of assignments) {
    const hadOverlap = a.rawIndices.some((i) => taken.has(i));
    if (!hadOverlap) {
      next.push(a);
      continue;
    }
    const remaining = [...new Set(a.rawIndices.filter((i) => !taken.has(i)))].sort((x, y) => x - y);
    if (remaining.length === 0 || (a.mode === 'merge' && remaining.length < 2)) {
      removedGroupIds.push(a.groupId);
      continue;
    }
    // Composition changed: drop any stale confirmation.
    next.push({
      groupId: a.groupId,
      mode: a.mode,
      rawIndices: remaining,
      ...(a.name !== undefined ? { name: a.name } : {}),
    });
  }

  const groupId = makeGroupId ? makeGroupId() : nextFreeGroupId(assignments);
  const created: GroupAssignment = {
    groupId,
    mode: op.type,
    rawIndices: uniqueSorted,
    ...(cleanName !== undefined ? { name: cleanName } : {}),
  };
  next.push(created);

  if (next.length > MAX_GROUPS) {
    return failOp('too_many_groups', `Too many groups (max ${MAX_GROUPS}).`);
  }

  return {
    ok: true,
    assignments: next,
    groupId,
    removedGroupIds,
  };
}
