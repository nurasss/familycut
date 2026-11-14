// Recurring-expense detection, rule-based (TZ §7.3). Pure functions, integer cents.
import { MULTIPLIER, annualCents } from '@/lib/engine/money';
import { GENERATED_ID_PREFIX } from '@/lib/engine/parse';
import { formatUsd } from '@/lib/format';
import type { Confidence, Expense, Frequency, SystemFlag, Transaction } from '@/lib/types';

export type AnalyzeStats = {
  /** Total transactions received. */
  parsed: number;
  excludedRefunds: number;
  /** Exact duplicates (same date+merchant+amount+transaction ID) dropped. */
  excludedDuplicates: number;
  /** Incoming non-refund credits (e.g. payroll), not expenses. */
  credits: number;
};

export const STORE_REASON = 'Regular store purchases — not a subscription';

// ---------- dictionaries ----------

const STORE_RE =
  /\b(WHOLE FOODS|TRADER JOE|KROGER|WALMART|SAFEWAY|COSTCO|TARGET|ALDI|PUBLIX|WEGMANS|GROCERY|SUPERMARKET|MARKET|STARBUCKS|MCDONALD|CHIPOTLE|RESTAURANT|CAFE|DINER|PIZZA|GRILL|BURGER|SUSHI|TACO|DOORDASH|UBER EATS|GRUBHUB)/i;

const CATEGORY_RULES: [Expense['category'], RegExp][] = [
  ['Groceries', /\b(WHOLE FOODS|TRADER JOE|KROGER|WALMART|SAFEWAY|COSTCO|TARGET|ALDI|PUBLIX|WEGMANS|GROCERY|SUPERMARKET|MARKET)/i],
  ['Entertainment', /\b(NETFLIX|SPOTIFY|HULU|DISNEY|HBO|PARAMOUNT|PEACOCK|YOUTUBE|PRIME|APPLE MUSIC|STREAMING|MUSIC)/i],
  ['Health & fitness', /\b(FITNESS|GYM|YMCA|YOGA|CROSSFIT|PILATES|PELOTON)/i],
  ['Utilities', /\b(COMCAST|SPECTRUM|VERIZON|AT&T|T-MOBILE|INTERNET|ELECTRIC|WATER|GAS|UTILIT|CABLE|WIRELESS|MOBILE)/i],
  ['Software', /\b(ICLOUD|GOOGLE ONE|DROPBOX|ADOBE|MICROSOFT|CLOUD|SOFTWARE)/i],
];

const SUBSCRIPTION_KEYWORDS = /\b(ANNUAL|ANNUALLY|YEARLY|MONTHLY|MEMBERSHIP|SUBSCRIPTION|RENEWAL|PREMIUM|PLAN)\b/i;

export function categorize(merchant: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(merchant)) return cat;
  return 'Other';
}

export function isRegularStore(merchant: string): boolean {
  return STORE_RE.test(merchant);
}

// ---------- frequency ----------

const BANDS: { freq: Exclude<Frequency, 'unknown'>; min: number; max: number }[] = [
  { freq: 'weekly', min: 6, max: 8 },
  { freq: 'monthly', min: 27, max: 34 },
  { freq: 'quarterly', min: 88, max: 95 },
  { freq: 'yearly', min: 355, max: 375 },
];

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function frequencyOfGaps(gaps: number[]): Exclude<Frequency, 'unknown'> | null {
  if (gaps.length === 0) return null;
  for (const b of BANDS) {
    if (gaps.every((g) => g >= b.min && g <= b.max)) return b.freq;
  }
  return null;
}

// ---------- helpers ----------

const spreadWithin10 = (amounts: number[]): boolean => {
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return (max - min) * 10 <= min;
};

function clusterByAmount(txs: Transaction[]): Transaction[][] {
  const clusters: Transaction[][] = [];
  for (const tx of [...txs].sort((a, b) => a.amountCents - b.amountCents)) {
    const c = clusters.find((cl) => {
      const ref = cl[0].amountCents;
      return Math.abs(tx.amountCents - ref) * 10 <= ref;
    });
    if (c) c.push(tx);
    else clusters.push([tx]);
  }
  return clusters.map((c) => c.sort((a, b) => a.date.localeCompare(b.date)));
}

const downgrade = (c: Confidence): Confidence => (c === 'high' ? 'medium' : c === 'medium' ? 'low' : c);

function baseConfidence(freq: Exclude<Frequency, 'unknown'>, charges: number): Confidence {
  switch (freq) {
    case 'monthly':
      return charges >= 3 ? 'high' : 'medium';
    case 'weekly':
      return charges >= 4 ? 'high' : charges === 3 ? 'medium' : 'low';
    case 'quarterly':
      return charges >= 3 ? 'high' : 'medium';
    case 'yearly':
      return charges >= 3 ? 'high' : 'medium';
  }
}

function keywordFrequency(raw: string): Frequency {
  if (/\b(ANNUAL|ANNUALLY|YEARLY)\b/i.test(raw)) return 'yearly';
  if (/\bMONTHLY\b/i.test(raw)) return 'monthly';
  return 'unknown';
}

type Series = {
  merchant: string;
  txs: Transaction[]; // all transactions (incl. same-day dups), sorted by date
};

/** Price changes once at most: returns [before, after] or null. */
function singlePriceChange(amounts: number[]): [number, number] | null {
  let k = -1;
  for (let i = 0; i < amounts.length - 1; i++) {
    if (Math.abs(amounts[i] - amounts[i + 1]) * 10 > amounts[i]) {
      if (k !== -1) return null;
      k = i;
    }
  }
  if (k === -1) return null;
  const left = amounts.slice(0, k + 1);
  const right = amounts.slice(k + 1);
  if (!spreadWithin10(left) || !spreadWithin10(right)) return null;
  return [amounts[k], amounts[amounts.length - 1]];
}

function describe(series: Series): Omit<Expense, 'id'> | null {
  const { merchant, txs } = series;
  const store = isRegularStore(merchant);
  const category = categorize(merchant);

  // One entry per calendar day for cadence; same-day repeats are duplicate candidates.
  const byDate = new Map<string, Transaction[]>();
  for (const t of txs) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const days = [...byDate.keys()].sort();
  const dayAmounts = days.map((d) => byDate.get(d)![0].amountCents);
  const flags: SystemFlag[] = [];
  const sameDayDup = [...byDate.values()].some(
    (g) => g.length > 1 && g.every((t) => t.amountCents === g[0].amountCents),
  );
  if (sameDayDup) flags.push('duplicate_candidate');

  const charges = days.length;
  const gaps = days.slice(1).map((d, i) => dayNumber(d) - dayNumber(days[i]));
  const freq = frequencyOfGaps(gaps);
  const last = dayAmounts[dayAmounts.length - 1];
  const reasons: string[] = [];

  const subscriptionish =
    ['Entertainment', 'Health & fitness', 'Utilities', 'Software'].includes(category) ||
    SUBSCRIPTION_KEYWORDS.test(txs.map((t) => t.merchantRaw).join(' '));

  if (freq) {
    let confidence = baseConfidence(freq, charges);
    const stable = spreadWithin10(dayAmounts);
    const change = stable ? null : singlePriceChange(dayAmounts);
    const avgGap = Math.floor(gaps.reduce((a, b) => a + b, 0) / gaps.length);

    if (stable) {
      reasons.push(`${charges} charges of ${formatUsd(last)}, ~${avgGap} days apart`);
    } else {
      reasons.push(`${charges} charges, ~${avgGap} days apart`);
      if (change) {
        reasons.push(`Price changed from ${formatUsd(change[0])} to ${formatUsd(change[1])}`);
        if (change[1] > change[0]) flags.push('price_increase');
      } else {
        reasons.push('Amounts vary between charges');
        confidence = downgrade(confidence);
      }
    }
    if (sameDayDup) reasons.push('Identical charges on the same day — possible duplicate');

    if (store) {
      confidence = 'low';
      reasons.push(STORE_REASON);
    }
    return {
      merchant,
      category,
      frequency: freq,
      priceCents: last,
      confidence,
      reasons,
      flags,
      transactionIds: txs.map((t) => t.id),
      decision: 'undecided',
      actionStatus: 'not_started',
    };
  }

  // No consistent cadence. Only keep as a weak candidate if it plausibly is a subscription.
  if (store || !subscriptionish) return null;
  const guessed = charges === 1 ? keywordFrequency(txs.map((t) => t.merchantRaw).join(' ')) : 'unknown';
  reasons.push(
    charges === 1
      ? `Single charge of ${formatUsd(last)} — not enough history to confirm`
      : `${charges} charges at irregular intervals`,
  );
  if (sameDayDup) reasons.push('Identical charges on the same day — possible duplicate');
  return {
    merchant,
    category,
    frequency: guessed,
    priceCents: last,
    confidence: 'low',
    reasons,
    flags,
    transactionIds: txs.map((t) => t.id),
    decision: 'undecided',
    actionStatus: 'not_started',
  };
}

// ---------- public API ----------

/** Find recurring expenses in normalized transactions (TZ §7.3). */
export function detectRecurring(txs: Transaction[]): Expense[] {
  return analyzeTransactions(txs).expenses;
}

/** detectRecurring plus counters for the /audit screen. */
export function analyzeTransactions(txs: Transaction[]): { expenses: Expense[]; stats: AnalyzeStats } {
  const stats: AnalyzeStats = { parsed: txs.length, excludedRefunds: 0, excludedDuplicates: 0, credits: 0 };

  // 1) Exact duplicates: same date + merchant + amount + (real) transaction ID.
  const seen = new Set<string>();
  const debits: Transaction[] = [];
  for (const t of txs) {
    const hasId = !t.id.startsWith(GENERATED_ID_PREFIX);
    if (hasId) {
      const key = [t.date, t.merchantNormalized, t.amountCents, t.id].join('|');
      if (seen.has(key)) {
        stats.excludedDuplicates++;
        continue;
      }
      seen.add(key);
    }
    // 2) Refunds and incoming credits never count as spend.
    if (t.isRefund) {
      stats.excludedRefunds++;
    } else if (t.amountCents < 0) {
      stats.credits++;
    } else if (t.amountCents > 0) {
      debits.push(t);
    }
  }

  // 3) Group by merchant, then split into series.
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of debits) {
    const key = t.merchantNormalized || t.merchantRaw;
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const expenses: Expense[] = [];
  const usedIds = new Set<string>();
  const push = (e: Omit<Expense, 'id'>) => {
    const slug = e.merchant.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = `exp-${slug}-${e.priceCents}`;
    for (let n = 2; usedIds.has(id); n++) id = `exp-${slug}-${e.priceCents}-${n}`;
    usedIds.add(id);
    expenses.push({ ...e, id });
  };

  for (const [merchant, group] of byMerchant) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    // Whole merchant as one series first (handles price changes); else split by amount.
    const days = [...new Set(sorted.map((t) => t.date))].sort();
    const gaps = days.slice(1).map((d, i) => dayNumber(d) - dayNumber(days[i]));
    const wholeFits = days.length >= 2 && frequencyOfGaps(gaps) !== null;
    const parts = wholeFits ? [sorted] : clusterByAmount(sorted);
    for (const part of parts) {
      const e = describe({ merchant, txs: part });
      if (e) push(e);
    }
  }

  expenses.sort((a, b) => annualCents(b.priceCents, b.frequency) - annualCents(a.priceCents, a.frequency));
  return { expenses, stats };
}

// ---------- review candidates ----------

/**
 * Top review candidates (FR-11): undecided, known frequency, not a regular-store pattern, and either
 * flagged or reasonably expensive. Sorted by annual cost. Never changes a decision; the returned copies
 * get a leading "why review" reason.
 */
export function pickReviewCandidates(expenses: Expense[], n = 3): Expense[] {
  const limit = Math.min(5, Math.max(3, Math.round(n)));
  const MIN_ANNUAL_CENTS = 10_000; // $100/year
  return expenses
    .filter(
      (e) =>
        e.decision === 'undecided' &&
        MULTIPLIER[e.frequency] > 0 &&
        e.category !== 'Groceries' &&
        !e.reasons.includes(STORE_REASON) &&
        e.confidence !== 'low' &&
        (e.flags.length > 0 || annualCents(e.priceCents, e.frequency) >= MIN_ANNUAL_CENTS),
    )
    .sort((a, b) => annualCents(b.priceCents, b.frequency) - annualCents(a.priceCents, a.frequency))
    .slice(0, limit)
    .map((e) => {
      const annual = formatUsd(annualCents(e.priceCents, e.frequency));
      const why = e.flags.includes('price_increase')
        ? `Worth a review: price went up (${annual}/year)`
        : e.flags.includes('duplicate_candidate')
          ? `Worth a review: possible duplicate charge (${annual}/year)`
          : `Worth a review: ${annual}/year`;
      return { ...e, reasons: [why, ...e.reasons], flags: [...e.flags] };
    });
}
