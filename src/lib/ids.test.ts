// Regression tests for W1B3: expense ids must be opaque (they are put in /action?id=... URLs), and saved audits
// with old revealing ids must migrate without losing user data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_EXPENSES } from '@/lib/fixtures/miller';
import { analyzeTransactions } from '@/lib/engine/detect';
import { normalizeMerchant } from '@/lib/engine/normalize';
import { applyMapping, parseCsv, suggestMapping } from '@/lib/engine/parse';
import type { Expense, Transaction } from '@/lib/types';
import { ensureOpaqueIds, isOpaqueExpenseId, newExpenseId } from './ids';

// Synthetic personal data.
const PII_DESCRIPTION = 'CUSTOM INTERNET JOHN SMITH john.smith@example.com account 12345678';
// Words can never occur in a hex id. Digits are covered by the strict /^exp-[0-9a-f]{32}$/ format check below
// (a short digit string like "75" can legitimately appear inside random hex).
const PII_FRAGMENTS = ['custom', 'internet', 'john', 'smith', 'example', 'account'];

const OLD_REVEALING_ID = 'exp-custom-internet-john-smith-john-smith-example-account-7500';

function importCsv(description: string) {
  const csv = [
    'Date,Description,Amount,Transaction ID',
    `2026-08-12,${description},-75.00,BANK-ACCT-12345678-A`,
    `2026-09-12,${description},-75.00,BANK-ACCT-12345678-B`,
    `2026-10-12,${description},-75.00,BANK-ACCT-12345678-C`,
  ].join('\n');
  const rows = parseCsv(csv);
  return applyMapping(rows, suggestMapping(Object.keys(rows[0]))!);
}

describe('newExpenseId / analyzer ids', () => {
  it('ids are opaque, unique and recognised as safe', () => {
    const ids = Array.from({ length: 500 }, () => newExpenseId());
    expect(new Set(ids).size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^exp-[0-9a-f]{32}$/);
      expect(isOpaqueExpenseId(id)).toBe(true);
    }
  });

  it('imported expense with a personal-data description gets an id with nothing from the statement', () => {
    const { rows, errors } = importCsv(PII_DESCRIPTION);
    expect(errors).toEqual([]);
    const { expenses } = analyzeTransactions(rows);
    expect(expenses).toHaveLength(1);
    const [e] = expenses;
    expect(e.merchant.toLowerCase()).toContain('john'); // the name stays local, for display
    expect(e.id).toMatch(/^exp-[0-9a-f]{32}$/);
    const hrefId = encodeURIComponent(e.id);
    for (const f of PII_FRAGMENTS) expect(hrefId.toLowerCase()).not.toContain(f);
    for (const t of e.transactionIds) expect(e.id).not.toContain(t);
    expect(e.id).not.toBe(OLD_REVEALING_ID);
  });

  it('same data analysed twice gives different ids (a stale link never points at a different expense), same results otherwise', () => {
    const { rows } = importCsv('NETFLIX.COM 8844');
    const a = analyzeTransactions(rows).expenses[0];
    const b = analyzeTransactions(rows).expenses[0];
    expect(a.id).not.toBe(b.id);
    expect({ ...a, id: '' }).toEqual({ ...b, id: '' });
  });

  it('several services of one merchant and a custom id factory still get unique ids', () => {
    const tx = (id: string, date: string, merchant: string, cents: number): Transaction => ({
      id, date, merchantRaw: merchant, merchantNormalized: normalizeMerchant(merchant), amountCents: cents, isRefund: false, currency: 'USD',
    });
    const txs = [8, 9, 10].flatMap((m, i) => [
      tx(`a${i}`, `2026-${m}-03`.replace(/-(\d)-/, '-0$1-'), 'ADOBE *1', 999),
      tx(`b${i}`, `2026-${m}-03`.replace(/-(\d)-/, '-0$1-'), 'ADOBE *2', 1999),
    ]);
    let n = 0;
    const { expenses } = analyzeTransactions(txs, { newId: () => `test-${++n}` });
    expect(expenses.map((e) => e.id).sort()).toEqual(['test-1', 'test-2']);
    const rnd = analyzeTransactions(txs).expenses.map((e) => e.id);
    expect(new Set(rnd).size).toBe(rnd.length);
  });
});

describe('isOpaqueExpenseId / ensureOpaqueIds', () => {
  const exp = (id: string): Expense => ({
    id, merchant: 'X', category: 'Other', frequency: 'monthly', priceCents: 100, confidence: 'high', reasons: [],
    flags: [], transactionIds: [], decision: 'undecided', actionStatus: 'not_started',
  });

  it('old derived ids are revealing; uuid, store fallback, new and sample ids are safe', () => {
    for (const id of [OLD_REVEALING_ID, 'exp-netflix-1549', 'exp-netflix-1549-2', 'internet', 'exp-', '']) {
      expect(isOpaqueExpenseId(id), id).toBe(false);
    }
    expect(isOpaqueExpenseId(undefined)).toBe(false);
    expect(isOpaqueExpenseId('3f2b8c1e-6a4d-4e2f-9b1a-0c5d7e8f9a10')).toBe(true);
    expect(isOpaqueExpenseId('id-1763150000000-k3j9x2ab')).toBe(true);
    for (const d of DEMO_EXPENSES) expect(isOpaqueExpenseId(d.id)).toBe(true);
  });

  it('replaces only revealing ids, keeps everything else, keeps ids unique, and is stable when applied twice', () => {
    const safe = newExpenseId();
    const list = [exp(OLD_REVEALING_ID), exp(safe), exp('exp-netflix-1549'), exp('exp-netflix-1549'), exp('demo-fitness')];
    const once = ensureOpaqueIds(list);
    expect(once[1].id).toBe(safe);
    expect(once[4].id).toBe('demo-fitness');
    expect(once.every((e) => isOpaqueExpenseId(e.id))).toBe(true);
    expect(new Set(once.map((e) => e.id)).size).toBe(5);
    expect(ensureOpaqueIds(once).map((e) => e.id)).toEqual(once.map((e) => e.id));
    expect(once.map((e) => ({ ...e, id: '' }))).toEqual(list.map((e) => ({ ...e, id: '' })));
    expect(list[0].id).toBe(OLD_REVEALING_ID); // input untouched
  });
});

// ---- real persist / migrate / rehydrate ----

function fakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    raw: data,
  };
}

describe('saved audits with revealing ids are migrated (same storage key, no data loss)', () => {
  let ls: ReturnType<typeof fakeLocalStorage>;
  beforeEach(() => {
    ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  const NOW = '2026-11-14T10:00:00.000Z';
  const legacyExpense = (over: Partial<Expense>): Expense => ({
    id: OLD_REVEALING_ID,
    merchant: 'Custom Internet John Smith John Smith Example Account',
    category: 'Utilities',
    frequency: 'monthly',
    priceCents: 7500,
    confidence: 'high',
    reasons: ['3 charges of $75.00, ~30 days apart'],
    flags: ['review_price'],
    transactionIds: ['BANK-ACCT-12345678-A'],
    decision: 'negotiate',
    targetPriceCents: 6000,
    actionStatus: 'completed',
    reportedNewPriceCents: 6000,
    completedAt: NOW,
    notes: 'call on Friday',
    ...over,
  });

  const seedLegacy = async (version: number | undefined, expenses: Expense[]) => {
    const mod = await import('@/lib/store');
    ls.setItem(
      mod.STORAGE_KEY,
      JSON.stringify({
        state: { isDemo: false, session: { version: 1, id: 's1', createdAt: NOW, updatedAt: NOW, goal: { name: 'Trip', targetCents: 100000 }, expenses } },
        ...(version === undefined ? {} : { version }),
      }),
    );
    vi.resetModules();
    return mod.STORAGE_KEY;
  };
  const stored = (key: string) => JSON.parse(ls.getItem(key)!);

  it('v1 data: ids become opaque, every other field is kept, storage is rewritten under the same key', async () => {
    const legacy = [
      legacyExpense({}),
      legacyExpense({ id: 'exp-netflix-1549', merchant: 'Netflix', priceCents: 1549, decision: 'cut', targetPriceCents: undefined, actionStatus: 'attempted', reportedNewPriceCents: undefined, completedAt: undefined, notes: undefined }),
      legacyExpense({ id: 'exp-netflix-1549-2', merchant: 'Netflix', decision: 'keep', actionStatus: 'not_started', reportedNewPriceCents: undefined, completedAt: undefined }),
    ];
    const key = await seedLegacy(1, legacy);
    expect(key).toBe('familycut:audit:v1');

    const mod = await import('@/lib/store');
    const s = mod.useAuditStore.getState().session!;
    expect(s.expenses).toHaveLength(3);
    expect(s.goal).toEqual({ name: 'Trip', targetCents: 100000 });
    expect(s.id).toBe('s1');
    legacy.forEach((old, i) => {
      const now = s.expenses[i];
      expect(isOpaqueExpenseId(now.id)).toBe(true);
      expect(now.id).not.toBe(old.id);
      expect(now.transactionIds).toEqual([]);
      expect({ ...now, id: '', transactionIds: [] }).toEqual({ ...old, id: '', transactionIds: [] }); // decisions, prices, targets, statuses, notes: identical
    });
    expect(new Set(s.expenses.map((e) => e.id)).size).toBe(3);

    // written back immediately, under the same key, at the new version, with no revealing id or bank transactionId left
    const raw = stored(key);
    expect(raw.version).toBe(mod.STORAGE_VERSION);
    expect(raw.version).toBe(3);
    const rawText = ls.getItem(key)!;
    expect(rawText).not.toContain(OLD_REVEALING_ID);
    expect(rawText).not.toContain('exp-netflix-1549');
    expect(rawText).not.toContain('BANK-ACCT-12345678-A');
    expect(raw.state.session.expenses.map((e: Expense) => e.id)).toEqual(s.expenses.map((e) => e.id));
  });

  it('ids are stable after further reloads (migration happens once)', async () => {
    const key = await seedLegacy(1, [legacyExpense({}), legacyExpense({ id: 'exp-netflix-1549', merchant: 'Netflix' })]);
    let mod = await import('@/lib/store');
    const first = mod.useAuditStore.getState().session!.expenses.map((e) => e.id);
    for (let i = 0; i < 3; i++) {
      vi.resetModules();
      mod = await import('@/lib/store');
      expect(mod.useAuditStore.getState().session!.expenses.map((e) => e.id)).toEqual(first);
    }
    expect(stored(key).state.session.expenses.map((e: Expense) => e.id)).toEqual(first);
  });

  it('an older numeric version (0) is migrated too', async () => {
    const key = await seedLegacy(0, [legacyExpense({})]);
    const mod = await import('@/lib/store');
    expect(isOpaqueExpenseId(mod.useAuditStore.getState().session!.expenses[0].id)).toBe(true);
    expect(stored(key).version).toBe(3);
  });

  it('after migration decisions keep working through the new ids and the link target is the new id', async () => {
    await seedLegacy(1, [legacyExpense({})]);
    const mod = await import('@/lib/store');
    const [e] = mod.useAuditStore.getState().session!.expenses;
    expect(`/action?id=${encodeURIComponent(e.id)}`).toMatch(/^\/action\?id=exp-[0-9a-f]{32}$/);
    mod.useAuditStore.getState().setDecision(e.id, 'cut');
    expect(mod.useAuditStore.getState().session!.expenses[0]).toMatchObject({ id: e.id, decision: 'cut', actionStatus: 'not_started' });
    vi.resetModules();
    const reloaded = await import('@/lib/store');
    expect(reloaded.useAuditStore.getState().session!.expenses[0]).toMatchObject({ id: e.id, decision: 'cut' });
  });

  it('v2 data keeps safe ids while stripping bank transactionIds to v3, and current-version clean data is untouched', async () => {
    const id = newExpenseId();
    const key = await seedLegacy(2, [legacyExpense({ id })]);
    const modV2 = await import('@/lib/store');
    expect(modV2.useAuditStore.getState().session!.expenses[0].id).toBe(id);
    expect(modV2.useAuditStore.getState().session!.expenses[0].transactionIds).toEqual([]);
    expect(ls.getItem(key)).not.toContain('BANK-ACCT-12345678-A');
    expect(stored(key).version).toBe(3);

    vi.resetModules();
    const cleanKey = await seedLegacy(3, [legacyExpense({ id, transactionIds: [] })]);
    const beforeClean = ls.getItem(cleanKey);
    const modV3 = await import('@/lib/store');
    expect(modV3.useAuditStore.getState().session!.expenses[0].id).toBe(id);
    expect(ls.getItem(cleanKey)).toBe(beforeClean);
  });

  it('sample data ids are kept and garbage in storage does not crash', async () => {
    const key = await seedLegacy(1, DEMO_EXPENSES.map((e) => ({ ...e })));
    const mod = await import('@/lib/store');
    expect(mod.useAuditStore.getState().session!.expenses.map((e) => e.id)).toEqual(DEMO_EXPENSES.map((e) => e.id));
    ls.setItem(key, JSON.stringify({ state: { session: { expenses: 'nope' } }, version: 1 }));
    vi.resetModules();
    await expect(import('@/lib/store')).resolves.toBeDefined();
    ls.setItem(key, 'not json');
    vi.resetModules();
    await expect(import('@/lib/store')).resolves.toBeDefined();
  });

  it('a fresh import saved through the store never writes a revealing id to localStorage', async () => {
    const mod = await import('@/lib/store');
    const { rows } = importCsv(PII_DESCRIPTION);
    mod.useAuditStore.getState().startSession(analyzeTransactions(rows).expenses, { isDemo: false });
    const [e] = mod.useAuditStore.getState().session!.expenses;
    const raw = stored(mod.STORAGE_KEY);
    expect(raw.state.session.expenses[0].id).toBe(e.id);
    expect(e.id).toMatch(/^exp-[0-9a-f]{32}$/);
  });
});
