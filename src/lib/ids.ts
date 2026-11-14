// Opaque identifiers for local expenses. Browser-safe, no server imports.
//
// An expense id ends up in the URL (/action?id=...) and therefore in browser history and, on a page reload, in a
// GET request to the server. It must never contain the merchant name, an amount, a bank transaction ID or any
// fragment of a statement description. The id is only a local identifier, NOT an access or share token.
import { DEMO_EXPENSES } from '@/lib/fixtures/miller';
import type { Expense } from '@/lib/types';

function randomHex(bytes: number): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'getRandomValues' in c) {
    return [...c.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Last resort for environments without Web Crypto; ids only need to be unique, not unguessable.
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

/** New opaque id: "exp-" + 128 random bits. Unique, carries no information about the expense. */
export function newExpenseId(): string {
  return `exp-${randomHex(16)}`;
}

const SAFE_PATTERNS: RegExp[] = [
  /^exp-[0-9a-f]{32}$/, // newExpenseId()
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, // crypto.randomUUID() (manual expenses)
  /^id-\d{10,}-[a-z0-9]{1,10}$/, // store fallback id without crypto.randomUUID
];
const FIXTURE_IDS = new Set(DEMO_EXPENSES.map((e) => e.id));

/**
 * True for ids that are known to be opaque or fixed sample-data ids. Everything else (including the old
 * "exp-<merchant-slug>-<cents>" ids, which can contain pieces of a statement description) is treated as revealing.
 */
export function isOpaqueExpenseId(id: unknown): boolean {
  return typeof id === 'string' && (FIXTURE_IDS.has(id) || SAFE_PATTERNS.some((re) => re.test(id)));
}

/**
 * Replaces every revealing id with a fresh opaque one and keeps everything else. Safe ids are untouched, so the
 * result is stable when applied twice. Ids stay unique even if the input had duplicates.
 */
export function ensureOpaqueIds<T extends Pick<Expense, 'id'>>(
  expenses: T[],
  makeId: () => string = newExpenseId,
): T[] {
  const used = new Set<string>();
  return expenses.map((e) => {
    let id = e.id;
    if (!isOpaqueExpenseId(id) || used.has(id)) {
      do id = makeId();
      while (used.has(id));
    }
    used.add(id);
    return id === e.id ? e : { ...e, id };
  });
}
