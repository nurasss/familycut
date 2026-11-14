// Recurring-expense detection, rule-based (TZ §7.3) and manual grouping (F09). Pure functions, integer cents.
import {
  type AmbiguityKind,
  type ExpenseSource,
  type GroupAssignment,
  type GroupIssue,
  type GroupProposal,
  type GroupReport,
  MAX_GROUPS,
  normalizeGroupName,
} from '@/lib/engine/grouping';
import { MULTIPLIER, annualCents } from '@/lib/engine/money';
import { GENERATED_ID_PREFIX, MAX_AMOUNT_CENTS } from '@/lib/engine/parse';
import { formatUsd } from '@/lib/format';
import { newExpenseId } from '@/lib/ids';
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

const dayCache = new Map<string, number>();

function dayNumber(iso: string): number {
  let n = dayCache.get(iso);
  if (n === undefined) {
    n = Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
    if (dayCache.size > 50_000) dayCache.clear();
    dayCache.set(iso, n);
  }
  return n;
}

function frequencyOfGaps(gaps: number[]): Exclude<Frequency, 'unknown'> | null {
  if (gaps.length === 0) return null;
  for (const b of BANDS) {
    if (gaps.every((g) => g >= b.min && g <= b.max)) return b.freq;
  }
  return null;
}

// ---------- helpers ----------

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

// ---------- series building ----------

/** All identical charges (same date and amount) of one merchant, collapsed. Exact repeats are duplicate candidates. */
type Slot = { date: string; day: number; amountCents: number; txs: Transaction[] };

/** One candidate recurring series: at most one slot per calendar day, consecutive gaps share one cadence band. */
type Chain = { idx: number; slots: Slot[]; band: Frequency | null };

// Plain code-unit comparison (ISO dates sort correctly); localeCompare is far slower and not needed for a total order.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Total order, so the result never depends on the order of the input rows. */
const txOrder = (a: Transaction, b: Transaction): number =>
  cmp(a.date, b.date) ||
  a.amountCents - b.amountCents ||
  cmp(a.merchantRaw, b.merchantRaw) ||
  cmp(a.id, b.id) ||
  (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);

const relDiff = (a: number, b: number): number => Math.abs(a - b) / Math.min(a, b);

function buildSlots(txs: Transaction[]): Slot[] {
  const slots = new Map<string, Slot>();
  for (const t of [...txs].sort(txOrder)) {
    const key = `${t.date}|${t.amountCents}`;
    const slot = slots.get(key);
    if (slot) slot.txs.push(t);
    else slots.set(key, { date: t.date, day: dayNumber(t.date), amountCents: t.amountCents, txs: [t] });
  }
  return [...slots.values()];
}

const lastOf = (c: Chain): Slot => c.slots[c.slots.length - 1];

// (day, amount) -> number key; amounts are capped far below 1e9 cents by the API schema.
const dayAmountKey = (day: number, amountCents: number): number => day * 1e9 + amountCents;

/** Chains of identical amounts whose consecutive gaps all lie in ONE band. `slots` must be sorted by date. */
function chainsForBand(slots: Slot[], band: (typeof BANDS)[number]): Chain[] {
  const chains: Chain[] = [];
  // A slot (date + amount) belongs to exactly one chain, so (last day, amount) identifies the chain it ends.
  const byLast = new Map<number, Chain>();
  for (const s of slots) {
    let found: Chain | undefined;
    for (let gap = band.min; gap <= band.max && !found; gap++) {
      found = byLast.get(dayAmountKey(s.day - gap, s.amountCents));
    }
    if (found) {
      byLast.delete(dayAmountKey(lastOf(found).day, s.amountCents));
      found.slots.push(s);
      byLast.set(dayAmountKey(s.day, s.amountCents), found);
    } else {
      const c: Chain = { idx: chains.length, slots: [s], band: band.freq };
      chains.push(c);
      byLast.set(dayAmountKey(s.day, s.amountCents), c);
    }
  }
  return chains.filter((c) => c.slots.length >= 2);
}

/**
 * Split one merchant's charges into independent series. The result never depends on input order.
 *
 * 1. Stable series: candidates are chains of identical amounts in one cadence band (weekly / monthly /
 *    quarterly / yearly), built for every band. The longest history wins, so a local coincidence (two
 *    different services billed a week apart) never decides the cadence over a longer, steadier series;
 *    on a tie the longer period wins. Charges used by a series are removed and the rest is searched again.
 *    Two charges on the same day can never be in one series.
 * 2. Price changes: remaining series and single charges are joined end-to-start when the gap fits their
 *    band, preferring established bands and the closest amounts. A joined pair is one series with a price change.
 */
function buildChains(txs: Transaction[]): Chain[] {
  let remaining = buildSlots(txs);
  const found: Chain[] = [];

  for (let round = 0; round < 3 && remaining.length >= 2; round++) {
    const candidates = BANDS.flatMap((band, rank) => chainsForBand(remaining, band).map((c) => ({ c, rank })));
    if (candidates.length === 0) break;
    candidates.sort(
      (x, y) =>
        y.c.slots.length - x.c.slots.length ||
        y.rank - x.rank ||
        x.c.slots[0].day - y.c.slots[0].day ||
        x.c.idx - y.c.idx,
    );
    const taken = new Set<Slot>();
    let dropped = false;
    for (const { c } of candidates) {
      if (c.slots.some((s) => taken.has(s))) {
        dropped = true;
        continue;
      }
      c.slots.forEach((s) => taken.add(s));
      found.push(c);
    }
    remaining = remaining.filter((s) => !taken.has(s));
    if (!dropped) break; // nothing competed for the same charges: no need to search the rest again
  }

  const chains: Chain[] = [...found, ...remaining.map((s) => ({ idx: 0, slots: [s], band: null as Frequency | null }))];
  chains.sort((x, y) => x.slots[0].day - y.slots[0].day || x.slots[0].amountCents - y.slots[0].amountCents);
  chains.forEach((c, i) => (c.idx = i));
  return joinPriceChanges(chains);
}

type Path = { chains: Chain[]; band: Frequency | null };

// More unrelated series than this means a noisy merchant (shop, marketplace): price-change inference is meaningless
// there and would only cost time on very large statements.
const MAX_CHAINS_FOR_PRICE_CHANGES = 60;

function joinPriceChanges(chains: Chain[]): Chain[] {
  if (chains.length > MAX_CHAINS_FOR_PRICE_CHANGES) return chains;
  const pathOf = new Map<Chain, Path>(chains.map((c) => [c, { chains: [c], band: c.band }]));
  const byEndDay = new Map<number, Chain[]>();
  for (const c of chains) byEndDay.set(lastOf(c).day, [...(byEndDay.get(lastOf(c).day) ?? []), c]);

  type Link = { x: Chain; y: Chain; band: Frequency; weak: number; d: number };
  const better = (p: Link, q: Link) => p.weak - q.weak || p.d - q.d || p.x.idx - q.x.idx;
  const links: Link[] = [];
  for (const y of chains) {
    const best: Link[] = []; // the 3 best predecessors of y, kept sorted; keeps noisy merchants cheap
    for (const band of BANDS) {
      if (y.band !== null && y.band !== band.freq) continue;
      for (let gap = band.min; gap <= band.max; gap++) {
        for (const x of byEndDay.get(y.slots[0].day - gap) ?? []) {
          if (x === y || (x.band !== null && x.band !== band.freq)) continue;
          const link: Link = {
            x,
            y,
            band: band.freq,
            weak: (x.band === null ? 1 : 0) + (y.band === null ? 1 : 0),
            d: relDiff(lastOf(x).amountCents, y.slots[0].amountCents),
          };
          let i = best.length;
          while (i > 0 && better(link, best[i - 1]) < 0) i--;
          if (i < 3) {
            best.splice(i, 0, link);
            if (best.length > 3) best.pop();
          }
        }
      }
    }
    links.push(...best);
  }
  links.sort((p, q) => p.weak - q.weak || p.d - q.d || p.x.idx - q.x.idx || p.y.idx - q.y.idx);

  for (const { x, y, band } of links) {
    const px = pathOf.get(x)!;
    const py = pathOf.get(y)!;
    if (px === py || px.chains[px.chains.length - 1] !== x || py.chains[0] !== y) continue;
    if ((px.band !== null && px.band !== band) || (py.band !== null && py.band !== band)) continue;
    px.chains.push(...py.chains);
    px.band = band;
    for (const c of py.chains) pathOf.set(c, px);
  }

  const paths = [...new Set(pathOf.values())];
  return paths
    .map((p, i) => ({ idx: i, slots: p.chains.flatMap((c) => c.slots), band: p.band }))
    .sort((x, y) => x.slots[0].day - y.slots[0].day || x.slots[0].amountCents - y.slots[0].amountCents);
}

// ---------- describing a series ----------

/** Runs of consecutive amounts within 1% of the run's first amount: separates a real price step from noise. */
function priceLevels(amounts: number[]): number[][] {
  const levels: number[][] = [];
  for (const a of amounts) {
    const cur = levels[levels.length - 1];
    if (cur && Math.abs(a - cur[0]) * 100 <= cur[0]) cur.push(a);
    else levels.push([a]);
  }
  return levels;
}

const softDowngrade = (c: Confidence): Confidence => (c === 'high' ? 'medium' : c);

const LARGE_CHANGE_RATIO = 1.5;
const MAX_GROUP_ID_LENGTH = 40;
const MAX_GROUP_ROWS = 10_000;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;
const DUP_REASON = 'Identical charges on the same day — possible duplicate (or two separate accounts)';

type DescribeExtras = {
  /** Last prices of other recurring series of the same merchant billed on the same day(s). */
  alongside?: number[];
  /** Per-merchant facts, computed once by the caller. */
  store?: boolean;
  category?: string;
};

type CadenceSummaryParams = {
  merchant: string;
  dayAmounts: number[];
  charges: number;
  avgGap: number | null;
  freq: Frequency;
  store: boolean;
  sameDayDup: boolean;
  mixedDay: boolean;
  alongside?: number[];
  initialConfidence: Confidence;
  flags: SystemFlag[];
  reasons: string[];
};

function pushTwoLevelPriceEvidence(
  levels: number[][],
  last: number,
  flags: SystemFlag[],
  reasons: string[],
): boolean {
  const [before, after] = [levels[0][levels[0].length - 1], last];
  reasons.push(`Price changed from ${formatUsd(before)} to ${formatUsd(after)}`);
  reasons.push(
    `Amounts seen: ${levels.map((l) => `${l.length} × ${formatUsd(l[l.length - 1])}`).join(', then ')}`,
  );
  if (after > before) flags.push('price_increase');
  const isLarge = relDiff(before, after) > LARGE_CHANGE_RATIO - 1;
  if (isLarge) {
    reasons.push('Large change — could also be a different plan or a separate service; check your statements');
  }
  return isLarge;
}

function applyCadenceAndPriceEvidence(params: CadenceSummaryParams): Confidence {
  const { dayAmounts, charges, avgGap, freq, store, sameDayDup, mixedDay, alongside, merchant, flags, reasons } = params;
  let confidence = params.initialConfidence;
  const last = dayAmounts[dayAmounts.length - 1];
  const min = Math.min(...dayAmounts);
  const max = Math.max(...dayAmounts);
  const levels = priceLevels(dayAmounts);

  if (freq !== 'unknown' && avgGap !== null) {
    if (levels.length === 1 && min === max) {
      reasons.push(`${charges} charges of ${formatUsd(last)}, ~${avgGap} days apart`);
    } else if (store) {
      // Grocery/restaurant prices always differ: no price-change noise.
      reasons.push(`${charges} charges, ~${avgGap} days apart`);
    } else if (levels.length === 1) {
      reasons.push(`${charges} charges of ${formatUsd(min)}–${formatUsd(max)}, ~${avgGap} days apart`);
    } else if (levels.length === 2) {
      reasons.push(`${charges} charges, ~${avgGap} days apart`);
      if (pushTwoLevelPriceEvidence(levels, last, flags, reasons)) {
        confidence = softDowngrade(confidence);
      }
    } else if ((max - min) * 10 <= min) {
      reasons.push(`${charges} charges of ${formatUsd(min)}–${formatUsd(max)}, ~${avgGap} days apart`);
    } else {
      reasons.push(`${charges} charges, ~${avgGap} days apart`);
      reasons.push('Amounts vary between charges');
      confidence = downgrade(confidence);
    }
  } else if (!store) {
    if (levels.length === 2) {
      pushTwoLevelPriceEvidence(levels, last, flags, reasons);
    } else if (levels.length > 2 && (max - min) * 10 > min) {
      reasons.push('Amounts vary between charges');
    }
  }

  if (sameDayDup) reasons.push(DUP_REASON);
  if (mixedDay) {
    reasons.push('Different amounts on the same day could not be separated — check your statements');
    confidence = softDowngrade(confidence);
  }
  if (alongside?.length) {
    const prices = [...new Set(alongside)].sort((a, b) => a - b).map(formatUsd).join(', ');
    reasons.push(
      `Billed on the same day as another ${merchant} charge (${prices}) — kept as a separate service, not merged; could be different products or accounts`,
    );
    confidence = softDowngrade(confidence);
  }
  if (store) {
    confidence = 'low';
    reasons.push(STORE_REASON);
  }
  return confidence;
}

function describe(merchant: string, slots: Slot[], extras: DescribeExtras = {}): Omit<Expense, 'id'> | null {
  const txs = slots.flatMap((s) => s.txs);
  const store = extras.store ?? isRegularStore(merchant);
  const category = extras.category ?? categorize(merchant);

  const byDate = new Map<string, Slot[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const days = [...byDate.keys()].sort();
  // Normally one slot per day. Several different amounts on one day only reach here from the leftover
  // fragments path; use the largest and say so instead of silently dropping the others.
  const dayAmounts = days.map((d) => Math.max(...byDate.get(d)!.map((s) => s.amountCents)));
  const mixedDay = [...byDate.values()].some((g) => g.length > 1);
  const flags: SystemFlag[] = [];
  const sameDayDup = slots.some((s) => s.txs.length > 1);
  if (sameDayDup) flags.push('duplicate_candidate');

  const charges = days.length;
  const gaps = days.slice(1).map((d, i) => dayNumber(d) - dayNumber(days[i]));
  const freq = frequencyOfGaps(gaps);
  const last = dayAmounts[dayAmounts.length - 1];
  const reasons: string[] = [];

  if (freq) {
    const avgGap = Math.floor(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const confidence = applyCadenceAndPriceEvidence({
      merchant,
      dayAmounts,
      charges,
      avgGap,
      freq,
      store,
      sameDayDup,
      mixedDay,
      alongside: extras.alongside,
      initialConfidence: baseConfidence(freq, charges),
      flags,
      reasons,
    });
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
  if (store) return null;
  const subscriptionish =
    ['Entertainment', 'Health & fitness', 'Utilities', 'Software'].includes(category) ||
    SUBSCRIPTION_KEYWORDS.test(txs.map((t) => t.merchantRaw).join(' '));
  if (!subscriptionish) return null;
  const guessed = charges === 1 ? keywordFrequency(txs.map((t) => t.merchantRaw).join(' ')) : 'unknown';
  reasons.push(
    charges === 1
      ? `Single charge of ${formatUsd(last)} — not enough history to confirm`
      : `${charges} charges at irregular intervals`,
  );
  if (sameDayDup) reasons.push(DUP_REASON);
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

// ---------- deterministic SHA-256 for proposalKey (browser-safe, synchronous) ----------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Int32Array(64);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  return h.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

// ---------- manual grouping helpers (F09) ----------

type ProducedExpense = {
  expense: Omit<Expense, 'id'>;
  txs: Transaction[];
  groupId?: string;
  assignedId?: string;
};

function isValidSourceIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && Number.isSafeInteger(v);
}

function extractSourceIndices(memberTxs: readonly Transaction[], ambiguous: ReadonlySet<number>): number[] {
  const out = new Set<number>();
  for (const t of memberTxs) {
    if (isValidSourceIndex(t.sourceIndex) && !ambiguous.has(t.sourceIndex)) {
      out.add(t.sourceIndex);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function analyzeMerchantBucket(
  displayMerchant: string,
  group: Transaction[],
  facts: { store: boolean; category: string },
): ProducedExpense[] {
  const out: ProducedExpense[] = [];
  const chains = buildChains(group);
  const recurring = chains.filter((c) => c.slots.length >= 2);
  // date -> recurring series billed that day; two or more on one day are parallel services of this merchant.
  const owners = new Map<string, number[]>();
  recurring.forEach((c, i) => c.slots.forEach((s) => owners.set(s.date, [...(owners.get(s.date) ?? []), i])));
  recurring.forEach((c, i) => {
    const partners = new Set<number>();
    for (const s of c.slots) for (const k of owners.get(s.date)!) if (k !== i) partners.add(k);
    const alongside = [...partners].map((k) => lastOf(recurring[k]).amountCents);
    const e = describe(displayMerchant, c.slots, { alongside, ...facts });
    if (e) out.push({ expense: e, txs: c.slots.flatMap((s) => s.txs) });
  });
  // Charges that never joined a series: group by amount as before (irregular candidates, single charges).
  const leftovers = chains.filter((c) => c.slots.length < 2).flatMap((c) => c.slots.flatMap((s) => s.txs));
  for (const part of clusterByAmount(leftovers)) {
    const slots = buildSlots(part);
    const e = describe(displayMerchant, slots, facts);
    if (e) out.push({ expense: e, txs: slots.flatMap((s) => s.txs) });
  }
  return out;
}

function pickDominantLabel(
  txs: readonly Transaction[],
  extract: (t: Transaction) => string | null,
  fallback: string,
): string {
  const counts = new Map<string, { count: number; latest: Transaction }>();
  for (const t of [...txs].sort(txOrder)) {
    const label = extract(t);
    if (!label) continue;
    const cur = counts.get(label);
    if (cur) {
      cur.count++;
      cur.latest = t;
    } else {
      counts.set(label, { count: 1, latest: t });
    }
  }
  let bestLabel = fallback;
  let bestCount = 0;
  let bestLatest: Transaction | null = null;
  for (const [label, info] of counts) {
    if (
      info.count > bestCount ||
      (info.count === bestCount && bestLatest !== null && txOrder(info.latest, bestLatest) > 0)
    ) {
      bestLabel = label;
      bestCount = info.count;
      bestLatest = info.latest;
    }
  }
  return bestLabel;
}

function pickDominantMerchant(txs: readonly Transaction[]): string {
  return pickDominantLabel(txs, (t) => t.merchantNormalized || t.merchantRaw, '');
}

function pickMergeCategory(txs: readonly Transaction[], autoMerchant: string): string {
  const primary = categorize(autoMerchant);
  if (primary !== 'Other') return primary;
  return pickDominantLabel(
    txs,
    (t) => {
      const cat = categorize(t.merchantNormalized || t.merchantRaw);
      return cat === 'Other' ? null : cat;
    },
    'Other',
  );
}

function describeMergedMultiPart(
  displayMerchant: string,
  chains: Chain[],
  freq: Frequency,
  store: boolean,
  category: string,
): Omit<Expense, 'id'> | null {
  if (freq === 'unknown' && store) return null;
  const allSlots = chains.flatMap((c) => c.slots);
  const allTxs = allSlots.flatMap((s) => s.txs);
  const dayAmounts = allSlots.map((s) => s.amountCents);
  const charges = allSlots.length;
  const last = dayAmounts[dayAmounts.length - 1];
  const gapDays = chains.slice(1).map((c, i) => c.slots[0].day - lastOf(chains[i]).day);
  const sameDayDup = allSlots.some((s) => s.txs.length > 1);
  const flags: SystemFlag[] = sameDayDup ? ['duplicate_candidate'] : [];

  const reasons: string[] = [`Grouped by you: ${allTxs.length} charges in ${chains.length} parts`];
  if (gapDays.length === 1) {
    const d = gapDays[0];
    reasons.push(`Gap of ${d} ${d === 1 ? 'day' : 'days'} between parts — months may be missing from the statement`);
  } else {
    reasons.push(`Gaps of ${gapDays.join(', ')} days between parts — months may be missing from the statement`);
  }

  let confidence: Confidence;
  if (freq === 'unknown') {
    reasons.push(`${charges} charges at irregular intervals`);
    applyCadenceAndPriceEvidence({
      merchant: displayMerchant,
      dayAmounts,
      charges,
      avgGap: null,
      freq: 'unknown',
      store: false,
      sameDayDup,
      mixedDay: false,
      initialConfidence: 'low',
      flags,
      reasons,
    });
    confidence = 'low';
  } else {
    const withinGaps = chains.flatMap((c) => c.slots.slice(1).map((s, i) => s.day - c.slots[i].day));
    const avgGap = Math.floor(withinGaps.reduce((a, b) => a + b, 0) / withinGaps.length);
    confidence = applyCadenceAndPriceEvidence({
      merchant: displayMerchant,
      dayAmounts,
      charges,
      avgGap,
      freq,
      store,
      sameDayDup,
      mixedDay: false,
      initialConfidence: baseConfidence(freq, charges),
      flags,
      reasons,
    });
    // Cap forced merges across gaps at medium confidence (never high).
    if (confidence === 'high') confidence = 'medium';
  }

  return {
    merchant: displayMerchant,
    category,
    frequency: freq,
    priceCents: last,
    confidence,
    reasons,
    flags,
    transactionIds: allTxs.map((t) => t.id),
    decision: 'undecided',
    actionStatus: 'not_started',
  };
}

function buildProposalKey(
  mode: GroupAssignment['mode'],
  customName: string | undefined,
  proposal: Omit<GroupProposal, 'proposalKey'>,
  activeTxs: readonly Transaction[],
): string {
  const rows = [...activeTxs]
    .sort((a, b) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0) || txOrder(a, b))
    .map((t) => [t.sourceIndex ?? null, t.date, t.amountCents, t.merchantNormalized]);
  const payload = JSON.stringify({
    mode,
    customName: customName ?? null,
    merchant: proposal.merchant,
    priceCents: proposal.priceCents,
    frequency: proposal.frequency,
    annualCents: proposal.annualCents,
    chargeCount: proposal.chargeCount,
    partCount: proposal.partCount,
    gapDays: proposal.gapDays,
    requires: proposal.requires,
    rows,
  });
  return `prop-${sha256Hex(payload).slice(0, 32)}`;
}

// ---------- public API ----------

export type AnalyzeOptions = {
  /** Id generator for new expenses (default: random opaque ids). Tests pass a counter. */
  newId?: () => string;
  /** Manual row assignments from import preview. Without them, result matches default detector. */
  groups?: readonly GroupAssignment[];
};

export type AnalyzeResult = {
  expenses: Expense[];
  stats: AnalyzeStats;
  /** Source row membership per expense. Transactions without sourceIndex have empty sourceIndices. */
  sources: ExpenseSource[];
  /** One report per passed GroupAssignment, in input order. */
  groups: GroupReport[];
};

/** Find recurring expenses in normalized transactions (TZ §7.3). */
export function detectRecurring(txs: Transaction[], options?: AnalyzeOptions): Expense[] {
  return analyzeTransactions(txs, options).expenses;
}

/** detectRecurring plus counters, manual grouping evaluation, and source links for /audit. */
export function analyzeTransactions(
  txs: Transaction[],
  options: AnalyzeOptions = {},
): AnalyzeResult {
  const stats: AnalyzeStats = { parsed: txs.length, excludedRefunds: 0, excludedDuplicates: 0, credits: 0 };

  // 0) Inspect sourceIndex uniqueness across all input transactions without mutating inputs.
  const sourceIndexCounts = new Map<number, number>();
  for (const t of txs) {
    if (isValidSourceIndex(t.sourceIndex)) {
      sourceIndexCounts.set(t.sourceIndex, (sourceIndexCounts.get(t.sourceIndex) ?? 0) + 1);
    }
  }
  const ambiguousSourceIndices = new Set<number>();
  for (const [idx, count] of sourceIndexCounts) {
    if (count > 1) ambiguousSourceIndices.add(idx);
  }

  const txBySourceIndex = new Map<number, Transaction>();
  for (const t of txs) {
    if (isValidSourceIndex(t.sourceIndex) && !ambiguousSourceIndices.has(t.sourceIndex)) {
      txBySourceIndex.set(t.sourceIndex, t);
    }
  }

  // 1) Exact duplicates: same date + merchant + amount + (real) transaction ID.
  // When sourceIndex is present, pick a deterministic representative (lowest sourceIndex) independent of txs order.
  const hasAnySourceIndex = sourceIndexCounts.size > 0;
  const survivorPosByDedupKey = new Map<string, number>();
  if (hasAnySourceIndex) {
    const bestByKey = new Map<string, { pos: number; tx: Transaction }>();
    txs.forEach((t, pos) => {
      if (t.id.startsWith(GENERATED_ID_PREFIX)) return;
      const key = [t.date, t.merchantNormalized, t.amountCents, t.id].join('|');
      const cur = bestByKey.get(key);
      if (!cur) {
        bestByKey.set(key, { pos, tx: t });
        return;
      }
      const aValid = isValidSourceIndex(t.sourceIndex);
      const bValid = isValidSourceIndex(cur.tx.sourceIndex);
      const better =
        (aValid && !bValid) ||
        (aValid && bValid && t.sourceIndex! < cur.tx.sourceIndex!) ||
        (aValid === bValid && t.sourceIndex === cur.tx.sourceIndex && txOrder(t, cur.tx) < 0);
      if (better) bestByKey.set(key, { pos, tx: t });
    });
    for (const [key, best] of bestByKey) survivorPosByDedupKey.set(key, best.pos);
  }

  const seen = new Set<string>();
  const debits: Transaction[] = [];
  const eligibleBySourceIndex = new Map<number, Transaction>();
  const excludedSourceIndices = new Set<number>();

  txs.forEach((t, pos) => {
    const hasId = !t.id.startsWith(GENERATED_ID_PREFIX);
    const validUniqueIdx =
      isValidSourceIndex(t.sourceIndex) && !ambiguousSourceIndices.has(t.sourceIndex) ? t.sourceIndex : null;

    if (hasId) {
      const key = [t.date, t.merchantNormalized, t.amountCents, t.id].join('|');
      const isDuplicate = hasAnySourceIndex ? pos !== survivorPosByDedupKey.get(key) : seen.has(key);
      if (isDuplicate) {
        stats.excludedDuplicates++;
        if (validUniqueIdx !== null) excludedSourceIndices.add(validUniqueIdx);
        return;
      }
      if (!hasAnySourceIndex) seen.add(key);
    }

    // 2) Refunds and incoming credits never count as spend.
    if (t.isRefund) {
      stats.excludedRefunds++;
      if (validUniqueIdx !== null) excludedSourceIndices.add(validUniqueIdx);
    } else if (t.amountCents < 0) {
      stats.credits++;
      if (validUniqueIdx !== null) excludedSourceIndices.add(validUniqueIdx);
    } else if (t.amountCents > 0) {
      debits.push(t);
      if (validUniqueIdx !== null) eligibleBySourceIndex.set(validUniqueIdx, t);
    } else if (validUniqueIdx !== null) {
      excludedSourceIndices.add(validUniqueIdx);
    }
  });

  if (hasAnySourceIndex) {
    debits.sort(
      (a, b) =>
        (isValidSourceIndex(a.sourceIndex) ? a.sourceIndex : Number.MAX_SAFE_INTEGER) -
        (isValidSourceIndex(b.sourceIndex) ? b.sourceIndex : Number.MAX_SAFE_INTEGER),
    );
  }

  // 3) Evaluate manual groups (if provided); only `applied` groups consume rows from the automatic pool.
  const newId = options.newId ?? newExpenseId;
  const inputGroups = options.groups ?? [];
  const groupReports: GroupReport[] = [];
  const consumedSourceIndices = new Set<number>();
  const groupedProduced: ProducedExpense[] = [];
  let hasAppliedGroups = false;

  if (inputGroups.length > 0) {
    const seenGroupIds = new Set<string>();
    const claimedSourceIndices = new Set<number>();

    const pushRejected = (groupId: string, code: GroupIssue['code'], message: string, rawIndices?: number[]) => {
      groupReports.push({
        groupId,
        status: 'rejected',
        activeRawIndices: [],
        ignoredRawIndices: [],
        issues: [{ code, severity: 'error', message, ...(rawIndices?.length ? { rawIndices } : {}) }],
        expenseIds: [],
      });
    };

    for (let gi = 0; gi < inputGroups.length; gi++) {
      const g = inputGroups[gi];
      const rawGroupId = g && typeof g === 'object' && typeof g.groupId === 'string' ? g.groupId : '';

      if (gi >= MAX_GROUPS) {
        pushRejected(rawGroupId, 'invalid_group', `Too many groups (max ${MAX_GROUPS}).`);
        continue;
      }
      if (
        !g ||
        typeof g !== 'object' ||
        typeof g.groupId !== 'string' ||
        g.groupId.trim().length === 0 ||
        g.groupId.length > MAX_GROUP_ID_LENGTH ||
        CONTROL_CHAR_RE.test(g.groupId)
      ) {
        pushRejected(rawGroupId, 'invalid_group', 'Invalid group identifier.');
        continue;
      }
      if (seenGroupIds.has(g.groupId)) {
        pushRejected(g.groupId, 'duplicate_group', 'Duplicate group identifier.');
        continue;
      }
      seenGroupIds.add(g.groupId);

      if ((g.mode !== 'split' && g.mode !== 'merge') || !Array.isArray(g.rawIndices) || g.rawIndices.length === 0) {
        pushRejected(g.groupId, 'invalid_group', 'Invalid group mode or empty row selection.');
        continue;
      }

      const dedupedSet = new Set<number>();
      const badIndices: number[] = [];
      let hasInvalidIndex = false;
      for (const idx of g.rawIndices) {
        if (!isValidSourceIndex(idx)) {
          hasInvalidIndex = true;
          if (typeof idx === 'number' && !Number.isNaN(idx)) badIndices.push(idx);
        } else {
          dedupedSet.add(idx);
        }
      }
      if (hasInvalidIndex) {
        pushRejected(g.groupId, 'invalid_group', 'Group contains invalid row indices.', badIndices);
        continue;
      }
      if (dedupedSet.size > MAX_GROUP_ROWS) {
        pushRejected(g.groupId, 'invalid_group', `Too many rows in group (max ${MAX_GROUP_ROWS}).`);
        continue;
      }

      const dedupedIndices = [...dedupedSet].sort((a, b) => a - b);
      const ambiguous = dedupedIndices.filter((idx) => ambiguousSourceIndices.has(idx));
      if (ambiguous.length > 0) {
        pushRejected(g.groupId, 'invalid_group', 'Ambiguous duplicate sourceIndex in input transactions.', ambiguous);
        continue;
      }

      const activeRawIndices: number[] = [];
      const activeTxs: Transaction[] = [];
      const ignoredRawIndices: GroupReport['ignoredRawIndices'] = [];
      const unknownIndices: number[] = [];
      const excludedIndices: number[] = [];
      const conflictIndices: number[] = [];

      for (const idx of dedupedIndices) {
        if (!txBySourceIndex.has(idx)) {
          ignoredRawIndices.push({ rawIndex: idx, reason: 'unknown_row' });
          unknownIndices.push(idx);
        } else if (excludedSourceIndices.has(idx) || !eligibleBySourceIndex.has(idx)) {
          ignoredRawIndices.push({ rawIndex: idx, reason: 'row_excluded' });
          excludedIndices.push(idx);
        } else if (claimedSourceIndices.has(idx)) {
          ignoredRawIndices.push({ rawIndex: idx, reason: 'row_in_other_group' });
          conflictIndices.push(idx);
        } else {
          activeRawIndices.push(idx);
          activeTxs.push(eligibleBySourceIndex.get(idx)!);
        }
      }

      for (const idx of activeRawIndices) claimedSourceIndices.add(idx);

      const issues: GroupIssue[] = [];
      if (unknownIndices.length > 0) {
        issues.push({
          code: 'unknown_row',
          severity: 'info',
          message: 'Some selected rows are missing from the analyzed transactions.',
          rawIndices: unknownIndices,
        });
      }
      if (excludedIndices.length > 0) {
        issues.push({
          code: 'row_excluded',
          severity: 'info',
          message: 'Refunds, credits, and exact duplicates cannot be included in a group.',
          rawIndices: excludedIndices,
        });
      }
      if (conflictIndices.length > 0) {
        issues.push({
          code: 'row_in_other_group',
          severity: 'warning',
          message: 'Some selected rows already belong to an earlier group.',
          rawIndices: conflictIndices,
        });
      }

      let customName: string | undefined;
      if (g.name !== undefined) {
        const normalized = normalizeGroupName(g.name);
        if (normalized === null) {
          issues.push({
            code: 'invalid_name',
            severity: 'warning',
            message: 'Custom group name is invalid and was ignored.',
          });
        } else {
          customName = normalized;
        }
      }

      if (g.mode === 'split') {
        if (activeTxs.length < 1) {
          issues.push({
            code: 'too_few_rows',
            severity: 'warning',
            message: 'No active rows remain in this split group.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'inactive',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
          });
          continue;
        }

        const byBucketMerchant = new Map<string, Transaction[]>();
        for (const t of activeTxs) {
          const key = t.merchantNormalized || t.merchantRaw;
          byBucketMerchant.set(key, [...(byBucketMerchant.get(key) ?? []), t]);
        }
        const produced: ProducedExpense[] = [];
        for (const [merchant, bucketTxs] of byBucketMerchant) {
          const display = customName ?? merchant;
          const facts = { store: isRegularStore(merchant), category: categorize(merchant) };
          for (const item of analyzeMerchantBucket(display, bucketTxs, facts)) {
            produced.push({
              ...item,
              expense: {
                ...item.expense,
                reasons: ['Separated by you: treated as its own service', ...item.expense.reasons],
              },
              groupId: g.groupId,
            });
          }
        }

        if (produced.some((p) => p.expense.priceCents > MAX_AMOUNT_CENTS)) {
          issues.push({
            code: 'amount_too_large',
            severity: 'error',
            message: 'Resulting expense exceeds the maximum allowed amount.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'rejected',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
          });
          continue;
        }

        for (const idx of activeRawIndices) consumedSourceIndices.add(idx);
        hasAppliedGroups = true;

        if (produced.length === 0) {
          issues.push({
            code: 'no_expense',
            severity: 'info',
            message: 'Selected rows do not form a recurring expense.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'applied',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
          });
          continue;
        }

        const ids: string[] = [];
        for (const p of produced) {
          const id = newId();
          ids.push(id);
          groupedProduced.push({ ...p, assignedId: id });
        }
        groupReports.push({
          groupId: g.groupId,
          status: 'applied',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: ids,
        });
        continue;
      }

      // g.mode === 'merge'
      if (activeTxs.length < 2) {
        issues.push({
          code: 'too_few_rows',
          severity: 'warning',
          message: 'Merge requires at least 2 active transactions.',
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'inactive',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [],
        });
        continue;
      }

      const autoMerchant = pickDominantMerchant(activeTxs);
      const displayMerchant = customName ?? autoMerchant;
      const store = mergeIsStore(activeTxs, autoMerchant);
      const category = pickMergeCategory(activeTxs, autoMerchant);

      // Single internal analysis key across all active rows regardless of merchantNormalized.
      const chains = buildChains(activeTxs);

      if (chains.length === 1) {
        const single = describe(displayMerchant, chains[0].slots, { store, category });
        if (!single) {
          for (const idx of activeRawIndices) consumedSourceIndices.add(idx);
          hasAppliedGroups = true;
          issues.push({
            code: 'no_expense',
            severity: 'info',
            message: 'Selected rows do not form a recurring expense.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'applied',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
          });
          continue;
        }
        if (single.priceCents > MAX_AMOUNT_CENTS) {
          issues.push({
            code: 'amount_too_large',
            severity: 'error',
            message: 'Resulting expense exceeds the maximum allowed amount.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'rejected',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
          });
          continue;
        }
        for (const idx of activeRawIndices) consumedSourceIndices.add(idx);
        hasAppliedGroups = true;
        const id = newId();
        groupedProduced.push({
          expense: {
            ...single,
            reasons: [`Grouped by you: ${activeTxs.length} charges`, ...single.reasons],
          },
          txs: chains[0].slots.flatMap((s) => s.txs),
          groupId: g.groupId,
          assignedId: id,
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'applied',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [id],
        });
        continue;
      }

      // k >= 2 chains: check overlap first, then mixed_periods.
      const hasOverlap = chains.some((c, i) => i > 0 && lastOf(chains[i - 1]).day >= c.slots[0].day);
      if (hasOverlap) {
        issues.push({
          code: 'overlapping_services',
          severity: 'error',
          message: 'Overlapping services cannot be merged into one price.',
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'rejected',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [],
        });
        continue;
      }

      const definedBands = [
        ...new Set(chains.map((c) => c.band).filter((b): b is Exclude<Frequency, 'unknown'> => b !== null)),
      ];
      if (definedBands.length > 1) {
        issues.push({
          code: 'mixed_periods',
          severity: 'error',
          message: 'Parts with different billing frequencies cannot be merged.',
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'rejected',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [],
        });
        continue;
      }

      const freq: Frequency = definedBands[0] ?? 'unknown';
      const merged = describeMergedMultiPart(displayMerchant, chains, freq, store, category);
      if (!merged) {
        for (const idx of activeRawIndices) consumedSourceIndices.add(idx);
        hasAppliedGroups = true;
        issues.push({
          code: 'no_expense',
          severity: 'info',
          message: 'Selected rows do not form a recurring expense.',
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'applied',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [],
        });
        continue;
      }

      if (merged.priceCents > MAX_AMOUNT_CENTS) {
        issues.push({
          code: 'amount_too_large',
          severity: 'error',
          message: 'Resulting expense exceeds the maximum allowed amount.',
        });
        groupReports.push({
          groupId: g.groupId,
          status: 'rejected',
          activeRawIndices,
          ignoredRawIndices,
          issues,
          expenseIds: [],
        });
        continue;
      }

      let hasLargePriceChange = false;
      for (let i = 0; i < chains.length && !hasLargePriceChange; i++) {
        for (let j = i + 1; j < chains.length; j++) {
          if (relDiff(lastOf(chains[i]).amountCents, chains[j].slots[0].amountCents) > LARGE_CHANGE_RATIO - 1) {
            hasLargePriceChange = true;
            break;
          }
        }
      }

      const gapDays = chains.slice(1).map((c, i) => c.slots[0].day - lastOf(chains[i]).day);
      const requires: AmbiguityKind[] = hasLargePriceChange ? ['large_price_change'] : [];
      let proposal: GroupProposal | undefined;

      if (requires.length > 0) {
        const proposalBase: Omit<GroupProposal, 'proposalKey'> = {
          merchant: displayMerchant,
          priceCents: merged.priceCents,
          frequency: freq,
          annualCents: annualCents(merged.priceCents, freq),
          chargeCount: activeTxs.length,
          partCount: chains.length,
          gapDays,
          requires,
        };
        const proposalKey = buildProposalKey(g.mode, customName, proposalBase, activeTxs);
        proposal = { proposalKey, ...proposalBase };

        const confirmedOk =
          g.confirmedFor === proposalKey &&
          Array.isArray(g.confirmed) &&
          requires.every((kind) => g.confirmed!.includes(kind));

        if (!confirmedOk) {
          issues.push({
            code: 'needs_confirmation',
            severity: 'warning',
            message: 'Large price change between parts requires confirmation before merging.',
          });
          groupReports.push({
            groupId: g.groupId,
            status: 'needs_confirmation',
            activeRawIndices,
            ignoredRawIndices,
            issues,
            expenseIds: [],
            proposal,
          });
          continue;
        }
      }

      for (const idx of activeRawIndices) consumedSourceIndices.add(idx);
      hasAppliedGroups = true;
      const id = newId();
      groupedProduced.push({
        expense: merged,
        txs: chains.flatMap((c) => c.slots).flatMap((s) => s.txs),
        groupId: g.groupId,
        assignedId: id,
      });
      groupReports.push({
        groupId: g.groupId,
        status: 'applied',
        activeRawIndices,
        ignoredRawIndices,
        issues,
        expenseIds: [id],
        ...(proposal ? { proposal } : {}),
      });
    }
  }

  // 4) Remaining eligible transactions go through the automatic merchant-based detector.
  const autoDebits =
    consumedSourceIndices.size === 0
      ? debits
      : debits.filter((t) => !(isValidSourceIndex(t.sourceIndex) && consumedSourceIndices.has(t.sourceIndex)));

  const byMerchant = new Map<string, Transaction[]>();
  for (const t of autoDebits) {
    const key = t.merchantNormalized || t.merchantRaw;
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const entries: { expense: Expense; source: ExpenseSource }[] = [];
  // Ids are opaque: never derived from the merchant, amounts, descriptions or bank transaction IDs (they end up in URLs).
  for (const item of groupedProduced) {
    const id = item.assignedId ?? newId();
    const sourceIndices = extractSourceIndices(item.txs, ambiguousSourceIndices);
    entries.push({
      expense: { ...item.expense, id },
      source: {
        expenseId: id,
        sourceIndices,
        ...(item.groupId !== undefined ? { groupId: item.groupId } : {}),
      },
    });
  }

  for (const [merchant, group] of byMerchant) {
    const facts = { store: isRegularStore(merchant), category: categorize(merchant) };
    for (const item of analyzeMerchantBucket(merchant, group, facts)) {
      const id = newId();
      const sourceIndices = extractSourceIndices(item.txs, ambiguousSourceIndices);
      entries.push({
        expense: { ...item.expense, id },
        source: { expenseId: id, sourceIndices },
      });
    }
  }

  entries.sort((a, b) => {
    const diff =
      annualCents(b.expense.priceCents, b.expense.frequency) -
      annualCents(a.expense.priceCents, a.expense.frequency);
    if (diff !== 0 || !hasAppliedGroups) return diff;
    return (
      cmp(a.expense.merchant, b.expense.merchant) ||
      b.expense.priceCents - a.expense.priceCents ||
      cmp(a.expense.frequency, b.expense.frequency) ||
      (a.source.sourceIndices[0] ?? Number.MAX_SAFE_INTEGER) -
        (b.source.sourceIndices[0] ?? Number.MAX_SAFE_INTEGER) ||
      cmp(a.expense.transactionIds.join('|'), b.expense.transactionIds.join('|'))
    );
  });

  return {
    expenses: entries.map((e) => e.expense),
    stats,
    sources: entries.map((e) => e.source),
    groups: groupReports,
  };
}

function mergeIsStore(txs: readonly Transaction[], autoMerchant: string): boolean {
  if (isRegularStore(autoMerchant)) return true;
  let storeCount = 0;
  for (const t of txs) {
    if (isRegularStore(t.merchantNormalized || t.merchantRaw)) storeCount++;
  }
  return storeCount * 2 >= txs.length;
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
