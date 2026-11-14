import { sanitizeExpense } from '@/lib/engine/lifecycle';
import { ensureOpaqueIds } from '@/lib/ids';
import type {
  ActionStatus,
  AuditSession,
  Confidence,
  Decision,
  Expense,
  FamilyGoal,
  Frequency,
  SystemFlag,
} from '@/lib/types';

/** Same key for every version: only `version` changes (v2 = opaque expense ids, v3 = stripped bank transactionIds). */
export const STORAGE_KEY = 'familycut:audit:v1';
export const STORAGE_VERSION = 3;

/** Strips raw bank transaction IDs before storing or hydrating expenses. Never mutates inputs. */
export function stripTransactionIds(expenses: readonly Expense[]): Expense[] {
  return expenses.map((expense) => ({ ...expense, transactionIds: [] }));
}

/** $1,000,000 cap, matching manual entry, CSV import, and POST /api/ai/action. */
export const MAX_PERSISTED_CENTS = 100_000_000;
export const MAX_PERSISTED_EXPENSES = 10_000;

const MAX_ID_LENGTH = 200;
const MAX_MERCHANT_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 200;
const MAX_GOAL_NAME_LENGTH = 200;
const MAX_NOTES_LENGTH = 10_000;
const MAX_ARRAY_ITEMS = 200;
const MAX_ARRAY_ITEM_LENGTH = 1_000;

export type PersistedAuditState = {
  session: AuditSession | null;
  isDemo: boolean;
};

const FREQUENCIES = new Set<Frequency>(['weekly', 'monthly', 'quarterly', 'yearly', 'unknown']);
const DECISIONS = new Set<Decision>(['undecided', 'keep', 'cut', 'negotiate', 'not_recurring']);
const ACTION_STATUSES = new Set<ActionStatus>(['not_started', 'attempted', 'completed']);
const CONFIDENCES = new Set<Confidence>(['high', 'medium', 'low', 'manual']);
const SYSTEM_FLAGS = new Set<SystemFlag>([
  'duplicate_candidate',
  'price_increase',
  'trial_ending_unknown',
  'review_price',
  'unclear_merchant',
]);

const ISO_TIMESTAMP_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const fallbackUid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const isoNow = () => new Date().toISOString();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function isValidCents(value: unknown, min = 0, max = MAX_PERSISTED_CENTS): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  if (!ISO_TIMESTAMP_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function asEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? (value as T) : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && item.length <= MAX_ARRAY_ITEM_LENGTH) {
      result.push(item);
      if (result.length >= MAX_ARRAY_ITEMS) break;
    }
  }
  return result;
}

function sanitizeFlags(value: unknown): SystemFlag[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SystemFlag>();
  const result: SystemFlag[] = [];
  for (const item of value) {
    if (typeof item === 'string' && SYSTEM_FLAGS.has(item as SystemFlag)) {
      const flag = item as SystemFlag;
      if (!seen.has(flag)) {
        seen.add(flag);
        result.push(flag);
      }
    }
  }
  return result;
}

function sanitizeGoal(raw: unknown): FamilyGoal | undefined {
  if (!isPlainRecord(raw)) return undefined;
  const name = own(raw, 'name');
  const targetCents = own(raw, 'targetCents');
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_GOAL_NAME_LENGTH) {
    return undefined;
  }
  if (!isValidCents(targetCents, 1, MAX_PERSISTED_CENTS)) {
    return undefined;
  }
  return { name, targetCents };
}

function sanitizePersistedExpense(raw: unknown, fallbackCompletedAt: string): Expense | null {
  if (!isPlainRecord(raw)) return null;

  const id = own(raw, 'id');
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > MAX_ID_LENGTH) return null;

  const merchant = own(raw, 'merchant');
  if (
    typeof merchant !== 'string' ||
    merchant.trim().length === 0 ||
    merchant.length > MAX_MERCHANT_LENGTH
  ) {
    return null;
  }

  const rawPrice = own(raw, 'priceCents');
  if (!isValidCents(rawPrice)) return null;

  const rawCategory = own(raw, 'category');
  const category =
    typeof rawCategory === 'string' &&
    rawCategory.trim().length > 0 &&
    rawCategory.length <= MAX_CATEGORY_LENGTH
      ? rawCategory
      : 'Other';

  const rawTarget = own(raw, 'targetPriceCents');
  const targetPriceCents = isValidCents(rawTarget) ? normalizeZero(rawTarget) : undefined;

  const rawReported = own(raw, 'reportedNewPriceCents');
  const reportedNewPriceCents = isValidCents(rawReported) ? normalizeZero(rawReported) : undefined;

  const rawCompletedAt = own(raw, 'completedAt');
  const completedAt = isValidTimestamp(rawCompletedAt) ? rawCompletedAt : undefined;

  const rawNotes = own(raw, 'notes');
  const notes =
    typeof rawNotes === 'string' && rawNotes.length <= MAX_NOTES_LENGTH ? rawNotes : undefined;

  const built: Expense = {
    id,
    merchant,
    category,
    frequency: asEnum(own(raw, 'frequency'), FREQUENCIES, 'unknown'),
    priceCents: normalizeZero(rawPrice),
    confidence: asEnum(own(raw, 'confidence'), CONFIDENCES, 'low'),
    reasons: sanitizeStringArray(own(raw, 'reasons')),
    flags: sanitizeFlags(own(raw, 'flags')),
    transactionIds: [],
    decision: asEnum(own(raw, 'decision'), DECISIONS, 'undecided'),
    actionStatus: asEnum(own(raw, 'actionStatus'), ACTION_STATUSES, 'not_started'),
    ...(targetPriceCents !== undefined ? { targetPriceCents } : {}),
    ...(reportedNewPriceCents !== undefined ? { reportedNewPriceCents } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };

  const lifecycleClean = sanitizeExpense(built);
  if (lifecycleClean.actionStatus === 'completed' && lifecycleClean.completedAt === undefined) {
    return { ...lifecycleClean, completedAt: fallbackCompletedAt };
  }
  return lifecycleClean;
}

function sanitizeSession(
  raw: unknown,
  opts: { dedupeIds: boolean } = { dedupeIds: true },
): AuditSession | null {
  if (!isPlainRecord(raw)) return null;
  const rawExpenses = own(raw, 'expenses');
  if (!Array.isArray(rawExpenses)) return null;

  const rawId = own(raw, 'id');
  const id =
    typeof rawId === 'string' && rawId.trim().length > 0 && rawId.length <= MAX_ID_LENGTH
      ? rawId
      : fallbackUid();

  const rawCreatedAt = own(raw, 'createdAt');
  const rawUpdatedAt = own(raw, 'updatedAt');
  const createdValid = isValidTimestamp(rawCreatedAt);
  const updatedValid = isValidTimestamp(rawUpdatedAt);
  const fallbackTs = createdValid ? rawCreatedAt : updatedValid ? rawUpdatedAt : isoNow();
  const createdAt = createdValid ? rawCreatedAt : fallbackTs;
  const updatedAt = updatedValid ? rawUpdatedAt : fallbackTs;

  const expenses: Expense[] = [];
  const seenIds = new Set<string>();
  for (const item of rawExpenses) {
    const clean = sanitizePersistedExpense(item, updatedAt);
    if (!clean) continue;
    if (opts.dedupeIds && seenIds.has(clean.id)) continue;
    seenIds.add(clean.id);
    expenses.push(clean);
    if (expenses.length >= MAX_PERSISTED_EXPENSES) break;
  }

  const goal = sanitizeGoal(own(raw, 'goal'));

  return {
    version: 1,
    id,
    createdAt,
    updatedAt,
    expenses,
    ...(goal ? { goal } : {}),
  };
}

/**
 * Runtime validation and sanitization for unknown persisted input.
 * - Rejects non-object/array envelopes and strips arbitrary/injected keys (no functions/actions can enter the store).
 * - Keeps valid records and fields intact; drops corrupted expenses/goals/fields with clear defaults.
 * - Enforces lifecycle invariants and safe integer cent bounds.
 */
export function sanitizePersisted(persisted: unknown): Partial<PersistedAuditState> {
  if (!isPlainRecord(persisted)) return {};
  const hasSession = Object.prototype.hasOwnProperty.call(persisted, 'session');
  const hasIsDemo = Object.prototype.hasOwnProperty.call(persisted, 'isDemo');
  if (!hasSession && !hasIsDemo) return {};

  const session = hasSession ? sanitizeSession(own(persisted, 'session'), { dedupeIds: true }) : null;
  const isDemo = session !== null && own(persisted, 'isDemo') === true;

  return { session, isDemo };
}

/**
 * Migrates older persisted audits to STORAGE_VERSION while keeping all user data intact:
 * - v0/v1 -> v2: replaces revealing expense ids ("exp-custom-...") with opaque ids via ensureOpaqueIds
 *   (keeping duplicate revealing ids distinct before reassigning).
 * - -> v3 (FC-SEC-02): strips raw bank transactionIds from persisted expenses.
 */
export function migratePersisted(persisted: unknown, fromVersion: number): Partial<PersistedAuditState> {
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion) || fromVersion >= STORAGE_VERSION) {
    return sanitizePersisted(persisted);
  }
  if (!isPlainRecord(persisted)) return {};
  const hasSession = Object.prototype.hasOwnProperty.call(persisted, 'session');
  const hasIsDemo = Object.prototype.hasOwnProperty.call(persisted, 'isDemo');
  if (!hasSession && !hasIsDemo) return {};

  // Pre-v2 kept duplicate revealing ids; deduplicate only from v2 onwards before reassigning opaque ids.
  const dedupeIds = fromVersion >= 2;
  const session = hasSession ? sanitizeSession(own(persisted, 'session'), { dedupeIds }) : null;
  const isDemo = session !== null && own(persisted, 'isDemo') === true;
  if (!session) return { session: null, isDemo: false };

  let expenses = session.expenses;
  if (fromVersion < 2) {
    expenses = ensureOpaqueIds(expenses);
  }
  if (fromVersion < 3) {
    expenses = stripTransactionIds(expenses);
  }

  return {
    session: {
      ...session,
      expenses,
    },
    isDemo,
  };
}
