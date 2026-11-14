// Shared contract types. Source of truth: docs/TZ.md §12.1, §10.2, §8, §7.
// All money values are integer USD cents.

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'unknown';
export type Decision = 'undecided' | 'keep' | 'cut' | 'negotiate' | 'not_recurring';
export type ActionStatus = 'not_started' | 'attempted' | 'completed';
export type Confidence = 'high' | 'medium' | 'low' | 'manual';
export type SystemFlag =
  | 'duplicate_candidate'
  | 'price_increase'
  | 'trial_ending_unknown'
  | 'review_price'
  | 'unclear_merchant';

export type Transaction = {
  id: string;
  date: string;
  merchantRaw: string;
  merchantNormalized: string;
  amountCents: number;
  isRefund: boolean;
  currency: 'USD';
};

export type Expense = {
  id: string;
  merchant: string;
  category: string;
  frequency: Frequency;
  priceCents: number;
  confidence: Confidence;
  reasons: string[];
  flags: SystemFlag[];
  transactionIds: string[];
  decision: Decision;
  actionStatus: ActionStatus;
  targetPriceCents?: number;
  reportedNewPriceCents?: number;
  completedAt?: string;
  notes?: string;
};

export type FamilyGoal = { name: string; targetCents: number };

export type AuditSession = {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  expenses: Expense[];
  goal?: FamilyGoal;
};

// ---- AI action endpoint (§10.2) ----
export type ActionKind = 'cut' | 'negotiate';
export type ActionTone = 'polite' | 'firm';

export type ActionRequest = {
  merchant: string;
  action: ActionKind;
  frequency: Frequency;
  currentPriceCents: number;
  targetPriceCents?: number;
  tone: ActionTone;
};

export type ActionResponse = {
  subject: string | null;
  body: string | null;
  callScript: string | null;
  steps: string[];
  limitations: string[];
  source: 'ai' | 'fallback';
};

// ---- Money ----
export type Totals = {
  recurringAnnualCents: number;
  potentialAnnualCents: number;
  reportedAnnualCents: number;
  plannedGoalPct: number;
  reportedGoalPct: number;
};

// ---- Import ----
export type RawRow = Record<string, string>;

export type ColumnMapping = {
  date: string;
  description: string;
  amount: string;
  /** Optional separate debit column (for banks with Debit/Credit columns). */
  debitColumn?: string;
  /** Optional column with the bank transaction ID (used for duplicate detection, §7.2). */
  transactionId?: string;
  signConvention: 'negative_is_debit' | 'positive_is_debit';
};

export type ParseResult = {
  rows: Transaction[];
  /** line: line number as the user sees it (see engine/parse.ts); index: 0-based position in the input rows. */
  errors: { line: number; index: number; reason: string }[];
};
