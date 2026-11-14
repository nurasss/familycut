// Regression tests for F02: execution state belongs to one concrete action and baseline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense } from '@/lib/types';
import { applyActionStatus, applyDecision, applyExpensePatch, sanitizeExpense } from './lifecycle';
import { computeTotals } from './money';

const internet = (over: Partial<Expense> = {}): Expense => ({
  id: 'internet',
  merchant: 'Internet Provider',
  category: 'Utilities',
  frequency: 'monthly',
  priceCents: 7500,
  confidence: 'high',
  reasons: ['x'],
  flags: [],
  transactionIds: [],
  decision: 'negotiate',
  actionStatus: 'not_started',
  targetPriceCents: 6000,
  ...over,
});

const NOW = '2026-11-14T10:00:00.000Z';
const completedNegotiate = () => applyActionStatus(internet(), 'completed', 6000, NOW);
const completedCut = () => applyActionStatus(internet({ decision: 'cut' }), 'completed', 0, NOW);
const annual = (e: Expense) => computeTotals([e]);

describe('F02 baseline: confirmed $75 -> $60 is $180/year (unchanged formulas)', () => {
  it('completed Negotiate reports $180/year, planned $180/year', () => {
    const e = completedNegotiate();
    expect(e).toMatchObject({ actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW });
    expect(annual(e)).toMatchObject({ potentialAnnualCents: 18000, reportedAnnualCents: 18000 });
  });
  it('completed Cut with $0 reports the full $900/year; undefined price means $0', () => {
    expect(annual(completedCut())).toMatchObject({ potentialAnnualCents: 90000, reportedAnnualCents: 90000 });
    expect(annual(applyActionStatus(internet({ decision: 'cut' }), 'completed', undefined, NOW)).reportedAnnualCents).toBe(90000);
  });
  it('non-completed statuses carry no reported price or date', () => {
    const e = applyActionStatus(completedNegotiate(), 'attempted');
    expect(e).toMatchObject({ actionStatus: 'attempted' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
  });
});

describe('F02 decision change resets the execution state', () => {
  it('completed Negotiate -> Cut: back to not_started, no reported price, no completedAt', () => {
    const e = applyDecision(completedNegotiate(), 'cut');
    expect(e).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
    expect('reportedNewPriceCents' in e).toBe(false);
    expect(annual(e)).toMatchObject({ potentialAnnualCents: 90000, reportedAnnualCents: 0 });
  });

  it('completed Cut ($0) -> Negotiate: the $0 is not carried over as a negotiation result', () => {
    const e = applyDecision(completedCut(), 'negotiate');
    expect(e).toMatchObject({ decision: 'negotiate', actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
    expect(annual(e)).toMatchObject({ potentialAnnualCents: 18000, reportedAnnualCents: 0 });
  });

  it('attempted is reset too, and Keep / Not recurring never inherit completed', () => {
    expect(applyDecision(applyActionStatus(internet(), 'attempted'), 'cut').actionStatus).toBe('not_started');
    for (const d of ['keep', 'not_recurring', 'undecided'] as const) {
      const e = applyDecision(completedNegotiate(), d);
      expect(e.actionStatus).toBe('not_started');
      expect(e.reportedNewPriceCents).toBeUndefined();
      expect(e.completedAt).toBeUndefined();
    }
  });

  it('setting the same decision again is idempotent and keeps the confirmation (same object)', () => {
    const done = completedNegotiate();
    expect(applyDecision(done, 'negotiate')).toBe(done);
    const sameViaPatch = applyExpensePatch(done, { decision: 'negotiate' }, NOW);
    expect(sameViaPatch).toMatchObject({ actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW });
  });

  it('round trip Negotiate -> Cut -> Negotiate requires a new confirmation', () => {
    const e = applyDecision(applyDecision(completedNegotiate(), 'cut'), 'negotiate');
    expect(e.actionStatus).toBe('not_started');
    expect(annual(e).reportedAnnualCents).toBe(0);
  });
});

describe('F02 updateExpense (patch) enforces the same invariants as setDecision', () => {
  it('a decision inside a patch resets exactly like applyDecision, in both directions', () => {
    for (const [from, to] of [
      [completedNegotiate(), 'cut'],
      [completedCut(), 'negotiate'],
    ] as const) {
      expect(applyExpensePatch(from, { decision: to }, NOW)).toEqual(applyDecision(from, to, NOW));
    }
  });

  it('a patch that copies the stale execution state along with a new decision does not bypass the reset', () => {
    const done = completedNegotiate();
    const e = applyExpensePatch(done, { ...done, decision: 'cut' }, NOW);
    expect(e).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
  });

  it('W1B2: execution fields inside a baseline-changing patch are never a confirmation (reviewed example)', () => {
    const done = completedNegotiate();
    const e = applyExpensePatch(done, { ...done, decision: 'cut', reportedNewPriceCents: 5999 }, '2026-12-01T00:00:00.000Z');
    expect(e).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined(); // the old date is gone too
    // the same for an explicit "completed" with a brand-new price, for every baseline field
    for (const change of [{ decision: 'cut' as const }, { priceCents: 8000 }, { frequency: 'yearly' as const }]) {
      const r = applyExpensePatch(done, { ...change, actionStatus: 'completed', reportedNewPriceCents: 0, completedAt: '2026-12-01T00:00:00.000Z' }, NOW);
      expect(r.actionStatus).toBe('not_started');
      expect(r.reportedNewPriceCents).toBeUndefined();
      expect(r.completedAt).toBeUndefined();
    }
  });

  it('W1B2: the new action is confirmed by a separate, later call', () => {
    const reset = applyExpensePatch(completedNegotiate(), { decision: 'cut', actionStatus: 'completed', reportedNewPriceCents: 0 }, NOW);
    const confirmed = applyActionStatus(reset, 'completed', 0, '2026-12-01T00:00:00.000Z');
    expect(confirmed).toMatchObject({ decision: 'cut', actionStatus: 'completed', reportedNewPriceCents: 0, completedAt: '2026-12-01T00:00:00.000Z' });
  });

  it('W1B2: Keep / Not recurring / undecided never hold attempted / completed through any public mutation', () => {
    const done = completedNegotiate();
    for (const d of ['keep', 'not_recurring', 'undecided'] as const) {
      // decision change together with execution fields (the reviewed "Keep with completed" case)
      const viaPatch = applyExpensePatch(done, { ...done, decision: d }, NOW);
      expect(viaPatch).toMatchObject({ decision: d, actionStatus: 'not_started' });
      expect(viaPatch.reportedNewPriceCents).toBeUndefined();
      expect(viaPatch.completedAt).toBeUndefined();
      // patching execution fields onto an already-inactive expense
      const inactive = applyDecision(done, d);
      for (const status of ['attempted', 'completed'] as const) {
        const p = applyExpensePatch(inactive, { actionStatus: status, reportedNewPriceCents: 100, completedAt: NOW }, NOW);
        expect(p.actionStatus).toBe('not_started');
        expect(p.reportedNewPriceCents).toBeUndefined();
        expect(p.completedAt).toBeUndefined();
        // and through the action-status mutation
        expect(applyActionStatus(inactive, status, 100, NOW)).toBe(inactive);
      }
    }
  });

  it('changing the original price resets the confirmation (new base, new confirmation)', () => {
    const e = applyExpensePatch(completedNegotiate(), { priceCents: 8000 }, NOW);
    expect(e).toMatchObject({ priceCents: 8000, actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
  });

  it('changing the frequency resets the confirmation', () => {
    const e = applyExpensePatch(completedNegotiate(), { frequency: 'quarterly' }, NOW);
    expect(e).toMatchObject({ frequency: 'quarterly', actionStatus: 'not_started' });
    expect(e.reportedNewPriceCents).toBeUndefined();
  });

  it('writing the same price / frequency again is not a change', () => {
    const done = completedNegotiate();
    const e = applyExpensePatch(done, { priceCents: 7500, frequency: 'monthly' }, NOW);
    expect(e).toMatchObject({ actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW });
  });

  it('changing only the target price does not rewrite the reported result of the same action', () => {
    const e = applyExpensePatch(completedNegotiate(), { targetPriceCents: 5500 }, NOW);
    expect(e).toMatchObject({ targetPriceCents: 5500, actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW });
    expect(annual(e)).toMatchObject({ potentialAnnualCents: 24000, reportedAnnualCents: 18000 });
    const cleared = applyExpensePatch(completedNegotiate(), { targetPriceCents: undefined }, NOW);
    expect(cleared.reportedNewPriceCents).toBe(6000);
  });

  it('merchant, category and notes edits never touch the execution state', () => {
    const e = applyExpensePatch(completedNegotiate(), { merchant: 'ISP', category: 'Other', notes: 'hi' }, NOW);
    expect(e).toMatchObject({ actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW });
  });

  it('the id cannot be changed through a patch', () => {
    expect(applyExpensePatch(internet(), { id: 'other' } as never, NOW).id).toBe('internet');
  });

  it('completed always has a date; reported / date never exist without completed', () => {
    expect(applyExpensePatch(internet(), { actionStatus: 'completed', reportedNewPriceCents: 6000 }, NOW).completedAt).toBe(NOW);
    const e = applyExpensePatch(completedNegotiate(), { actionStatus: 'attempted' }, NOW);
    expect(e.reportedNewPriceCents).toBeUndefined();
    expect(e.completedAt).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const done = Object.freeze(completedNegotiate());
    expect(() => applyExpensePatch(done, { decision: 'cut' }, NOW)).not.toThrow();
    expect(done.actionStatus).toBe('completed');
  });
});

describe('sanitizeExpense (legacy persisted state)', () => {
  it('drops an execution state on Keep / Not recurring / undecided, keeps everything else', () => {
    const legacy = internet({ decision: 'keep', actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW, notes: 'mine' });
    const e = sanitizeExpense(legacy);
    expect(e).toMatchObject({ actionStatus: 'not_started', notes: 'mine', priceCents: 7500, targetPriceCents: 6000 });
    expect(e.reportedNewPriceCents).toBeUndefined();
  });
  it('leaves valid completed Negotiate / Cut untouched (same object)', () => {
    const a = completedNegotiate();
    const b = completedCut();
    expect(sanitizeExpense(a)).toBe(a);
    expect(sanitizeExpense(b)).toBe(b);
  });
});

// ---- the real store, including persistence across a reload ----

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

describe('F02 through the zustand store (setDecision / updateExpense / reload)', () => {
  let ls: ReturnType<typeof fakeLocalStorage>;
  beforeEach(() => {
    ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const load = async () => import('@/lib/store');
  const seed = async () => {
    const mod = await load();
    mod.useAuditStore.getState().startSession([internet()], { isDemo: false });
    return mod;
  };
  const exp = (mod: Awaited<ReturnType<typeof load>>) => mod.useAuditStore.getState().session!.expenses[0];
  const totals = (mod: Awaited<ReturnType<typeof load>>) => {
    const s = mod.useAuditStore.getState().session!;
    return computeTotals(s.expenses, s.goal);
  };

  it('$75 -> $60 completed = $180/year, survives a reload', async () => {
    let mod = await seed();
    mod.useAuditStore.getState().setActionStatus('internet', 'completed', 6000);
    expect(totals(mod)).toMatchObject({ potentialAnnualCents: 18000, reportedAnnualCents: 18000 });
    vi.resetModules();
    mod = await load();
    expect(exp(mod)).toMatchObject({ decision: 'negotiate', actionStatus: 'completed', reportedNewPriceCents: 6000 });
    expect(totals(mod).reportedAnnualCents).toBe(18000);
    expect(ls.raw.has(mod.STORAGE_KEY)).toBe(true);
  });

  it('setDecision Negotiate -> Cut and Cut -> Negotiate reset the execution, and the reset survives a reload', async () => {
    let mod = await seed();
    const s = () => mod.useAuditStore.getState();
    s().setActionStatus('internet', 'completed', 6000);
    s().setDecision('internet', 'cut');
    expect(exp(mod)).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(exp(mod).reportedNewPriceCents).toBeUndefined();
    expect(totals(mod)).toMatchObject({ potentialAnnualCents: 90000, reportedAnnualCents: 0 });

    s().setActionStatus('internet', 'completed', 0);
    expect(totals(mod).reportedAnnualCents).toBe(90000);
    s().setDecision('internet', 'negotiate');
    expect(exp(mod)).toMatchObject({ decision: 'negotiate', actionStatus: 'not_started' });
    expect(totals(mod)).toMatchObject({ potentialAnnualCents: 18000, reportedAnnualCents: 0 });

    vi.resetModules();
    mod = await load();
    expect(exp(mod)).toMatchObject({ decision: 'negotiate', actionStatus: 'not_started' });
    expect(totals(mod).reportedAnnualCents).toBe(0);
  });

  it('updateExpense({ decision }) behaves exactly like setDecision', async () => {
    const mod = await seed();
    const s = () => mod.useAuditStore.getState();
    s().setActionStatus('internet', 'completed', 6000);
    s().updateExpense('internet', { decision: 'cut' });
    expect(exp(mod)).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(exp(mod).reportedNewPriceCents).toBeUndefined();
    expect(exp(mod).completedAt).toBeUndefined();
  });

  it('same decision again keeps the confirmation; target-only edit keeps the reported result; price edit resets', async () => {
    const mod = await seed();
    const s = () => mod.useAuditStore.getState();
    s().setActionStatus('internet', 'completed', 6000);
    s().setDecision('internet', 'negotiate');
    expect(exp(mod)).toMatchObject({ actionStatus: 'completed', reportedNewPriceCents: 6000 });
    s().setTargetPrice('internet', 5500);
    expect(exp(mod)).toMatchObject({ targetPriceCents: 5500, actionStatus: 'completed', reportedNewPriceCents: 6000 });
    s().updateExpense('internet', { priceCents: 8000 });
    expect(exp(mod)).toMatchObject({ priceCents: 8000, actionStatus: 'not_started' });
    expect(exp(mod).reportedNewPriceCents).toBeUndefined();
  });

  it('W1B2 through the store: baseline-changing updateExpense with execution fields resets; Keep rejects status changes', async () => {
    const mod = await seed();
    const s = () => mod.useAuditStore.getState();
    s().setActionStatus('internet', 'completed', 6000);
    const before = exp(mod);
    s().updateExpense('internet', { ...before, decision: 'cut', reportedNewPriceCents: 5999 });
    expect(exp(mod)).toMatchObject({ decision: 'cut', actionStatus: 'not_started' });
    expect(exp(mod).reportedNewPriceCents).toBeUndefined();
    expect(exp(mod).completedAt).toBeUndefined();
    expect(totals(mod).reportedAnnualCents).toBe(0);

    s().setDecision('internet', 'keep');
    s().setActionStatus('internet', 'completed', 0);
    s().setActionStatus('internet', 'attempted');
    s().updateExpense('internet', { actionStatus: 'completed', reportedNewPriceCents: 1, completedAt: NOW });
    expect(exp(mod)).toMatchObject({ decision: 'keep', actionStatus: 'not_started' });
    expect(exp(mod).reportedNewPriceCents).toBeUndefined();
    expect(exp(mod).completedAt).toBeUndefined();
  });

  it('unknown id is ignored', async () => {
    const mod = await seed();
    const before = mod.useAuditStore.getState().session;
    mod.useAuditStore.getState().setDecision('nope', 'cut');
    mod.useAuditStore.getState().updateExpense('nope', { priceCents: 1 });
    expect(mod.useAuditStore.getState().session).toBe(before);
  });

  it('legacy persisted state: key and user data kept, only an orphaned completed on Keep is dropped (ids are migrated separately, see ids.test.ts)', async () => {
    const mod0 = await load();
    ls.setItem(
      mod0.STORAGE_KEY,
      JSON.stringify({
        state: {
          isDemo: false,
          session: {
            version: 1,
            id: 's1',
            createdAt: NOW,
            updatedAt: NOW,
            goal: { name: 'Trip', targetCents: 100000 },
            expenses: [
              internet({ id: 'a', decision: 'keep', actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW, notes: 'keep me' }),
              internet({ id: 'b', decision: 'negotiate', actionStatus: 'completed', reportedNewPriceCents: 6000, completedAt: NOW }),
            ],
          },
        },
        version: 1,
      }),
    );
    vi.resetModules();
    const mod = await load();
    const [a, b] = mod.useAuditStore.getState().session!.expenses; // order is kept; ids of v1 data are migrated
    expect(a).toMatchObject({ decision: 'keep', actionStatus: 'not_started', notes: 'keep me' });
    expect(a.reportedNewPriceCents).toBeUndefined();
    expect(b).toMatchObject({ decision: 'negotiate', actionStatus: 'completed', reportedNewPriceCents: 6000 });
    expect(mod.useAuditStore.getState().session!.goal).toEqual({ name: 'Trip', targetCents: 100000 });
    expect(mod.STORAGE_KEY).toBe('familycut:audit:v1');
  });

  it('garbage in storage does not crash hydration', async () => {
    const mod0 = await load();
    ls.setItem(mod0.STORAGE_KEY, JSON.stringify({ state: { session: { expenses: 'nope' } }, version: 1 }));
    vi.resetModules();
    await expect(load()).resolves.toBeDefined();
  });
});
