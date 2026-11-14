import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTotals } from '@/lib/engine/money';
import { DEMO_EXPENSES, DEMO_GOAL } from '@/lib/fixtures/miller';
import { isOpaqueExpenseId, newExpenseId } from '@/lib/ids';
import {
  MAX_PERSISTED_CENTS,
  STORAGE_KEY,
  STORAGE_VERSION,
  migratePersisted,
  sanitizePersisted,
  stripTransactionIds,
} from '@/lib/persisted-state';
import type { AuditSession, Expense } from '@/lib/types';

const NOW = '2026-11-14T10:00:00.000Z';

function makeExpense(over: Partial<Expense> = {}): Expense {
  return {
    id: newExpenseId(),
    merchant: 'Netflix',
    category: 'Entertainment',
    frequency: 'monthly',
    priceCents: 1549,
    confidence: 'high',
    reasons: ['3 charges of $15.49, ~30 days apart'],
    flags: [],
    transactionIds: ['TX-1'],
    decision: 'cut',
    actionStatus: 'not_started',
    ...over,
  };
}

function makeSession(over: Partial<AuditSession> = {}): AuditSession {
  return {
    version: 1,
    id: 'session-1',
    createdAt: NOW,
    updatedAt: NOW,
    expenses: [makeExpense()],
    ...over,
  };
}

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

describe('sanitizePersisted: malformed envelopes & arbitrary/action injection', () => {
  it('returns {} for primitives, null, undefined, arrays, functions, and non-plain objects', () => {
    for (const bad of [
      undefined,
      null,
      0,
      42,
      'corrupt',
      true,
      [],
      [makeExpense()],
      () => {},
      new Date(),
      new Map(),
    ]) {
      expect(sanitizePersisted(bad)).toEqual({});
    }
    expect(sanitizePersisted({})).toEqual({});
  });

  it('drops non-object / missing-expenses session and resets isDemo to false when session is null', () => {
    expect(sanitizePersisted({ session: null, isDemo: true })).toEqual({
      session: null,
      isDemo: false,
    });
    expect(sanitizePersisted({ session: 'nope', isDemo: true })).toEqual({
      session: null,
      isDemo: false,
    });
    expect(sanitizePersisted({ session: [], isDemo: true })).toEqual({
      session: null,
      isDemo: false,
    });
    expect(sanitizePersisted({ session: { expenses: 'nope' }, isDemo: true })).toEqual({
      session: null,
      isDemo: false,
    });
  });

  it('strips arbitrary keys and injected functions/actions at top, session, expense, and goal levels', () => {
    const exp = makeExpense();
    const session = makeSession({
      expenses: [
        {
          ...exp,
          extraExpenseKey: 'evil',
          onClick: () => 'hack',
        } as unknown as Expense,
      ],
      goal: {
        name: 'Emergency fund',
        targetCents: 200000,
        evilGoalFn: () => 'bad',
      } as unknown as AuditSession['goal'],
    });

    const dirty = {
      session: {
        ...session,
        admin: true,
        setGoal: () => 'hijack',
      },
      isDemo: 'yes',
      startSession: () => 'hijack',
      setDecision: 'not-a-function',
      deleteAllData: 123,
      arbitraryProp: { nested: true },
    };

    const clean = sanitizePersisted(dirty);
    expect(Object.keys(clean).sort()).toEqual(['isDemo', 'session']);
    expect(clean.isDemo).toBe(false);
    expect(Object.keys(clean.session!).sort()).toEqual([
      'createdAt',
      'expenses',
      'goal',
      'id',
      'updatedAt',
      'version',
    ]);
    expect(clean.session!.goal).toEqual({ name: 'Emergency fund', targetCents: 200000 });
    expect('extraExpenseKey' in clean.session!.expenses[0]).toBe(false);
    expect('onClick' in clean.session!.expenses[0]).toBe(false);
  });

  it('ignores __proto__ payload from JSON.parse without polluting Object.prototype', () => {
    const payload = JSON.parse(
      JSON.stringify({
        __proto__: { polluted: true },
        session: makeSession(),
        isDemo: false,
      }),
    );
    const clean = sanitizePersisted(payload);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(clean).sort()).toEqual(['isDemo', 'session']);
    expect(clean.session?.expenses).toHaveLength(1);
  });
});

describe('sanitizePersisted: partial corruption, numeric bounds, enums, timestamps & string arrays', () => {
  it('keeps valid expenses and drops null, primitive, array, or structurally broken expenses', () => {
    const valid1 = makeExpense({ merchant: 'Spotify', priceCents: 1199 });
    const valid2 = makeExpense({ merchant: 'Gym', priceCents: 0 });
    const valid3 = makeExpense({ merchant: 'Cloud Max', priceCents: MAX_PERSISTED_CENTS });

    const dirty = {
      isDemo: false,
      session: makeSession({
        expenses: [
          null,
          undefined,
          42,
          'string',
          [],
          () => {},
          { id: '', merchant: 'Empty ID', priceCents: 100 },
          { id: 123, merchant: 'Numeric ID', priceCents: 100 },
          { id: newExpenseId(), merchant: '   ', priceCents: 100 },
          { id: newExpenseId(), merchant: 999, priceCents: 100 },
          valid1,
          { id: newExpenseId(), merchant: 'NaN Price', priceCents: Number.NaN },
          { id: newExpenseId(), merchant: 'Inf Price', priceCents: Number.POSITIVE_INFINITY },
          { id: newExpenseId(), merchant: 'NegInf Price', priceCents: Number.NEGATIVE_INFINITY },
          { id: newExpenseId(), merchant: 'Neg Price', priceCents: -1 },
          { id: newExpenseId(), merchant: 'Float Price', priceCents: 15.49 },
          { id: newExpenseId(), merchant: 'Too Big', priceCents: MAX_PERSISTED_CENTS + 1 },
          { id: newExpenseId(), merchant: 'String Price', priceCents: '1549' },
          valid2,
          valid3,
        ] as unknown as Expense[],
      }),
    };

    const clean = sanitizePersisted(dirty);
    expect(clean.session?.expenses).toEqual(stripTransactionIds([valid1, valid2, valid3]));

    const totals = computeTotals(clean.session!.expenses, clean.session!.goal);
    expect(Number.isFinite(totals.recurringAnnualCents)).toBe(true);
    expect(Number.isFinite(totals.potentialAnnualCents)).toBe(true);
    expect(Number.isFinite(totals.reportedAnnualCents)).toBe(true);
    expect(totals.recurringAnnualCents).toBe((1199 + MAX_PERSISTED_CENTS) * 12);
  });

  it('deduplicates duplicate expense ids in v2 state', () => {
    const id = newExpenseId();
    const first = makeExpense({ id, merchant: 'First' });
    const dup = makeExpense({ id, merchant: 'Duplicate' });
    const clean = sanitizePersisted({ session: makeSession({ expenses: [first, dup] }), isDemo: false });
    expect(clean.session?.expenses).toEqual(stripTransactionIds([first]));
  });

  it('normalizes invalid optional cents, enums, arrays, category, and notes without dropping valid expense', () => {
    const id = newExpenseId();
    const clean = sanitizePersisted({
      isDemo: false,
      session: makeSession({
        expenses: [
          {
            id,
            merchant: 'ISP Fiber',
            category: 123,
            frequency: 'daily',
            priceCents: 7500,
            confidence: 'certain',
            reasons: ['Valid reason', 42, null, '', { bad: true }],
            flags: ['review_price', 'review_price', 'bogus_flag', 123],
            transactionIds: ['TX-1', null, 99, 'TX-2'],
            decision: 'negotiate',
            actionStatus: 'completed',
            targetPriceCents: Number.NaN,
            reportedNewPriceCents: -500,
            completedAt: 'not-a-timestamp',
            notes: { bad: true },
          } as unknown as Expense,
        ],
      }),
    });

    const e = clean.session!.expenses[0];
    expect(e).toEqual({
      id,
      merchant: 'ISP Fiber',
      category: 'Other',
      frequency: 'unknown',
      priceCents: 7500,
      confidence: 'low',
      reasons: ['Valid reason'],
      flags: ['review_price'],
      transactionIds: [],
      decision: 'negotiate',
      actionStatus: 'completed',
      completedAt: NOW,
    });
    expect('targetPriceCents' in e).toBe(false);
    expect('reportedNewPriceCents' in e).toBe(false);
    expect('notes' in e).toBe(false);
  });

  it('enforces lifecycle invariants on corrupted decision/status combos', () => {
    const keepCompleted = makeExpense({
      decision: 'keep',
      actionStatus: 'completed',
      reportedNewPriceCents: 1000,
      completedAt: NOW,
      notes: 'keep notes',
    });
    const invalidDecisionWithCompleted = {
      ...makeExpense({
        actionStatus: 'completed',
        reportedNewPriceCents: 1000,
        completedAt: NOW,
      }),
      decision: 'invalid_decision',
    } as unknown as Expense;
    const attemptedWithReported = makeExpense({
      decision: 'cut',
      actionStatus: 'attempted',
      reportedNewPriceCents: 0,
      completedAt: NOW,
    });

    const clean = sanitizePersisted({
      isDemo: false,
      session: makeSession({
        expenses: [keepCompleted, invalidDecisionWithCompleted, attemptedWithReported],
      }),
    });

    const [a, b, c] = clean.session!.expenses;
    expect(a).toMatchObject({ decision: 'keep', actionStatus: 'not_started', notes: 'keep notes' });
    expect(a.reportedNewPriceCents).toBeUndefined();
    expect(a.completedAt).toBeUndefined();

    expect(b).toMatchObject({ decision: 'undecided', actionStatus: 'not_started' });
    expect(b.reportedNewPriceCents).toBeUndefined();
    expect(b.completedAt).toBeUndefined();

    expect(c).toMatchObject({ decision: 'cut', actionStatus: 'attempted' });
    expect(c.reportedNewPriceCents).toBeUndefined();
    expect(c.completedAt).toBeUndefined();
  });

  it('drops corrupted FamilyGoal while keeping valid session and expenses', () => {
    const exp = makeExpense();
    for (const badGoal of [
      null,
      'Trip',
      [],
      { name: '', targetCents: 10000 },
      { name: '   ', targetCents: 10000 },
      { name: 'Trip', targetCents: 0 },
      { name: 'Trip', targetCents: -100 },
      { name: 'Trip', targetCents: Number.NaN },
      { name: 'Trip', targetCents: Number.POSITIVE_INFINITY },
      { name: 'Trip', targetCents: 123.45 },
      { name: 'Trip', targetCents: MAX_PERSISTED_CENTS + 1 },
    ]) {
      const clean = sanitizePersisted({
        isDemo: false,
        session: makeSession({ expenses: [exp], goal: badGoal as unknown as AuditSession['goal'] }),
      });
      expect(clean.session?.expenses).toEqual(stripTransactionIds([exp]));
      expect(clean.session?.goal).toBeUndefined();
      expect('goal' in clean.session!).toBe(false);
    }
  });

  it('repairs missing/corrupted session version, id, and timestamps without losing valid expenses', () => {
    const exp = makeExpense();
    const clean = sanitizePersisted({
      isDemo: false,
      session: {
        version: 99,
        id: '   ',
        createdAt: '1', // V8 Date.parse('1') is truthy, must still be rejected as non-ISO
        updatedAt: 'not-a-date',
        expenses: [exp],
      } as unknown as AuditSession,
    });

    expect(clean.session?.version).toBe(1);
    expect(typeof clean.session?.id).toBe('string');
    expect(clean.session!.id.trim().length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(clean.session!.createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(clean.session!.updatedAt))).toBe(true);
    expect(clean.session?.expenses).toEqual(stripTransactionIds([exp]));
  });
});

describe('sanitizePersisted: preserves valid records and legitimate names/notes', () => {
  it('preserves DEMO_EXPENSES and DEMO_GOAL untouched apart from stripped transactionIds', () => {
    const session = makeSession({
      expenses: DEMO_EXPENSES.map((e) => ({ ...e, reasons: [...e.reasons], flags: [...e.flags] })),
      goal: { ...DEMO_GOAL },
    });
    const clean = sanitizePersisted({ session, isDemo: true });
    expect(clean).toEqual({
      session: { ...session, expenses: stripTransactionIds(session.expenses) },
      isDemo: true,
    });
  });

  it('does not truncate or reject legitimate long merchant names, Unicode, punctuation, or detailed notes', () => {
    const longMerchant =
      'AT&T Fiber Internet & TV Bundle — Café Müller / Family Account (North Austin #4421) — AutoPay Plan';
    const richNotes = [
      'Called support on Nov 14 (ref #99812).',
      'Agent Maria offered $55.00/mo for 12 months if we renew before Dec 1.',
      'Notes with symbols: 100% / €50 / — / "quoted" & emojis 🎉',
      'a'.repeat(500),
    ].join('\n');

    const exp = makeExpense({
      merchant: longMerchant,
      category: 'Utilities',
      decision: 'negotiate',
      priceCents: 8500,
      targetPriceCents: 5500,
      actionStatus: 'completed',
      reportedNewPriceCents: 5500,
      completedAt: NOW,
      notes: richNotes,
    });

    const clean = sanitizePersisted({
      isDemo: false,
      session: makeSession({ expenses: [exp] }),
    });
    expect(clean.session?.expenses[0]).toEqual({ ...exp, transactionIds: [] });
  });
});

describe('useAuditStore + localStorage: malformed envelopes, migrations, reloads, and action safety', () => {
  let ls: ReturnType<typeof fakeLocalStorage>;

  beforeEach(() => {
    ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps store actions intact and usable when localStorage injects action overrides and garbage', async () => {
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        state: {
          session: {
            version: 1,
            id: 's-inject',
            createdAt: NOW,
            updatedAt: NOW,
            setGoal: 'evil',
            expenses: [
              null,
              { id: 'bad', merchant: 'NaN', priceCents: null },
              makeExpense({ id: newExpenseId(), merchant: 'Valid Stream', priceCents: 1599, decision: 'cut' }),
            ],
            goal: { name: 'Trip', targetCents: -50 },
          },
          isDemo: 'yes',
          startSession: 'overwritten',
          setDecision: 123,
          deleteAllData: false,
          __proto__: { polluted: true },
        },
      }),
    );

    const mod = await import('@/lib/store');
    const state = mod.useAuditStore.getState();

    expect(typeof state.startSession).toBe('function');
    expect(typeof state.setDecision).toBe('function');
    expect(typeof state.setGoal).toBe('function');
    expect(typeof state.deleteAllData).toBe('function');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    expect(state.isDemo).toBe(false);
    expect(state.session?.version).toBe(1);
    expect(state.session?.expenses).toHaveLength(1);
    expect(state.session?.expenses[0].merchant).toBe('Valid Stream');
    expect(state.session?.goal).toBeUndefined();

    // Actions continue working normally
    const id = state.session!.expenses[0].id;
    state.setDecision(id, 'keep');
    expect(mod.useAuditStore.getState().session?.expenses[0].decision).toBe('keep');
  });

  it('survives malformed top-level JSON envelopes (null, array, primitive, empty object) without crashing', async () => {
    for (const raw of ['null', '[]', '123', '"hello"', '{}', JSON.stringify({ state: null, version: 2 })]) {
      ls.setItem(STORAGE_KEY, raw);
      vi.resetModules();
      const mod = await import('@/lib/store');
      expect(mod.useAuditStore.getState().session).toBeNull();
      expect(mod.useAuditStore.getState().isDemo).toBe(false);
      expect(typeof mod.useAuditStore.getState().loadDemo).toBe('function');
    }
  });

  it('migrates v0/v1 with partial corruption, duplicate revealing IDs, and lifecycle cleanup across reloads', async () => {
    const safeId = newExpenseId();
    ls.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          isDemo: false,
          setDecision: 'evil',
          session: {
            version: 1,
            id: 'legacy-s1',
            createdAt: NOW,
            updatedAt: NOW,
            goal: { name: 'Family trip', targetCents: 150000 },
            expenses: [
              null,
              { id: 'exp-bad', merchant: 'Corrupt', priceCents: -100 },
              makeExpense({
                id: 'exp-netflix-1549',
                merchant: 'Netflix Basic',
                decision: 'keep',
                actionStatus: 'completed',
                reportedNewPriceCents: 1000,
                completedAt: NOW,
              }),
              makeExpense({
                id: 'exp-netflix-1549',
                merchant: 'Netflix 4K',
                priceCents: 2299,
                decision: 'negotiate',
                targetPriceCents: 1500,
                actionStatus: 'completed',
                reportedNewPriceCents: 1799,
                completedAt: NOW,
                notes: 'Renewed annual discount',
              }),
              makeExpense({ id: safeId, merchant: 'Safe ID Service', priceCents: 999 }),
              makeExpense({ id: 'demo-fitness', merchant: 'Fitness membership', priceCents: 2999 }),
            ],
          },
        },
      }),
    );

    const mod = await import('@/lib/store');
    const s = mod.useAuditStore.getState().session!;
    expect(s.version).toBe(1);
    expect(s.expenses).toHaveLength(4);
    expect(s.expenses.every((e) => isOpaqueExpenseId(e.id))).toBe(true);
    expect(new Set(s.expenses.map((e) => e.id)).size).toBe(4);

    // Duplicate revealing IDs were both preserved with distinct opaque IDs
    expect(s.expenses[0].merchant).toBe('Netflix Basic');
    expect(s.expenses[0].actionStatus).toBe('not_started'); // lifecycle rule dropped orphaned completed on keep
    expect(s.expenses[0].reportedNewPriceCents).toBeUndefined();

    expect(s.expenses[1].merchant).toBe('Netflix 4K');
    expect(s.expenses[1].actionStatus).toBe('completed');
    expect(s.expenses[1].reportedNewPriceCents).toBe(1799);
    expect(s.expenses[1].notes).toBe('Renewed annual discount');

    // Already-safe IDs were preserved
    expect(s.expenses[2].id).toBe(safeId);
    expect(s.expenses[3].id).toBe('demo-fitness');

    // Rewritten to storage at STORAGE_VERSION (3) under familycut:audit:v1 without bank transactionIds
    const stored = JSON.parse(ls.getItem(STORAGE_KEY)!);
    expect(stored.version).toBe(STORAGE_VERSION);
    expect(stored.version).toBe(3);
    expect(stored.state.setDecision).toBeUndefined();
    expect(ls.getItem(STORAGE_KEY)).not.toContain('TX-1');

    // Subsequent reload preserves exact migrated IDs and totals
    const firstIds = s.expenses.map((e) => e.id);
    vi.resetModules();
    const reloaded = await import('@/lib/store');
    expect(reloaded.useAuditStore.getState().session!.expenses.map((e) => e.id)).toEqual(firstIds);
    expect(reloaded.useAuditStore.getState().session!.expenses.every((e) => e.transactionIds.length === 0)).toBe(true);
    const totals = computeTotals(
      reloaded.useAuditStore.getState().session!.expenses,
      reloaded.useAuditStore.getState().session!.goal,
    );
    expect(Number.isFinite(totals.recurringAnnualCents)).toBe(true);
    expect(totals.reportedAnnualCents).toBe((2299 - 1799) * 12);
  });

  it('migratePersisted handles v0 and out-of-range versions safely', () => {
    const v0 = migratePersisted(
      {
        isDemo: false,
        session: makeSession({
          expenses: [makeExpense({ id: 'exp-old-1000' })],
        }),
      },
      0,
    ) as { session: AuditSession; isDemo: boolean };
    expect(isOpaqueExpenseId(v0.session.expenses[0].id)).toBe(true);
    expect(v0.session.expenses[0].transactionIds).toEqual([]);

    const safeId = newExpenseId();
    const v2 = migratePersisted(
      {
        isDemo: false,
        extra: 'strip-me',
        session: makeSession({
          expenses: [makeExpense({ id: safeId }), null as unknown as Expense],
        }),
      },
      2,
    ) as { session: AuditSession; isDemo: boolean };
    expect(v2.session.expenses).toHaveLength(1);
    expect(v2.session.expenses[0].id).toBe(safeId);
    expect(v2.session.expenses[0].transactionIds).toEqual([]);
    expect('extra' in v2).toBe(false);
  });
});

describe('FC-SEC-02: bank transactionIds stripping across store boundary and migrations', () => {
  let ls: ReturnType<typeof fakeLocalStorage>;

  beforeEach(() => {
    ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stripTransactionIds clears bank IDs without mutating input objects or arrays', () => {
    const input = [
      makeExpense({ transactionIds: ['TXN-SECRET-111', 'TXN-SECRET-222', 'TXN-SECRET-333'] }),
    ];
    const originalIdsRef = input[0].transactionIds;

    const stripped = stripTransactionIds(input);
    expect(stripped).toHaveLength(1);
    expect(stripped[0].transactionIds).toEqual([]);
    expect(stripped[0].transactionIds).not.toBe(originalIdsRef);
    expect(input[0].transactionIds).toEqual(['TXN-SECRET-111', 'TXN-SECRET-222', 'TXN-SECRET-333']);
  });

  it('startSession, addExpense, loadDemo, and updateExpense never persist bank transactionIds in localStorage', async () => {
    const mod = await import('@/lib/store');
    const store = mod.useAuditStore.getState();

    const detected = [
      makeExpense({
        merchant: 'Netflix',
        priceCents: 1549,
        transactionIds: ['TXN-SECRET-111', 'TXN-SECRET-222', 'TXN-SECRET-333'],
        decision: 'cut',
      }),
    ];

    store.startSession(detected, { isDemo: false });
    expect(detected[0].transactionIds).toEqual(['TXN-SECRET-111', 'TXN-SECRET-222', 'TXN-SECRET-333']);

    // addExpense must strip transactionIds even if passed on input
    const manualId = store.addExpense({
      merchant: 'Custom VPN',
      priceCents: 999,
      frequency: 'monthly',
      transactionIds: ['TXN-SECRET-MANUAL'],
    });
    // updateExpense must also keep transactionIds stripped
    store.updateExpense(manualId, {
      transactionIds: ['TXN-SECRET-PATCH'],
      notes: 'Kept for travel',
    } as Partial<Omit<Expense, 'id'>>);

    const rawAfterUserWrites = ls.getItem(STORAGE_KEY)!;
    expect(rawAfterUserWrites).toBeTruthy();
    expect(rawAfterUserWrites).not.toContain('TXN-SECRET-');

    const persisted = JSON.parse(rawAfterUserWrites);
    expect(persisted.version).toBe(3);
    expect(persisted.state.session.expenses).toHaveLength(2);
    expect(persisted.state.session.expenses[0].transactionIds).toEqual([]);
    expect(persisted.state.session.expenses[1].transactionIds).toEqual([]);
    expect(persisted.state.session.expenses[1].notes).toBe('Kept for travel');

    // loadDemo also keeps transactionIds empty in persisted store
    store.loadDemo();
    const rawDemo = ls.getItem(STORAGE_KEY)!;
    expect(rawDemo).not.toContain('TX-1001');
    const parsedDemo = JSON.parse(rawDemo);
    expect(
      parsedDemo.state.session.expenses.every((e: Expense) => Array.isArray(e.transactionIds) && e.transactionIds.length === 0),
    ).toBe(true);
  });

  it('migrates v2 storage containing bank transactionIds to v3 while keeping decisions, prices, targets, statuses, reported, notes, goal, and isDemo', async () => {
    const id1 = newExpenseId();
    const id2 = newExpenseId();
    const legacyV2 = {
      version: 2,
      state: {
        isDemo: false,
        session: {
          version: 1,
          id: 'real-v2-session',
          createdAt: NOW,
          updatedAt: NOW,
          goal: { name: 'Emergency fund', targetCents: 250000 },
          expenses: [
            makeExpense({
              id: id1,
              merchant: 'Netflix',
              priceCents: 1549,
              frequency: 'monthly',
              transactionIds: ['TXN-SECRET-111', 'TXN-SECRET-222', 'TXN-SECRET-333'],
              decision: 'negotiate',
              targetPriceCents: 1199,
              actionStatus: 'completed',
              reportedNewPriceCents: 1299,
              completedAt: NOW,
              notes: 'Retention offer accepted',
            }),
            makeExpense({
              id: id2,
              merchant: 'Cloud Backup',
              priceCents: 999,
              frequency: 'monthly',
              transactionIds: ['ACCT-99887766'],
              decision: 'keep',
              actionStatus: 'not_started',
            }),
          ],
        },
      },
    };

    // Pure migratePersisted verification (preserving isDemo both false and true)
    const migratedDirect = migratePersisted({ ...legacyV2.state, isDemo: true }, 2);
    expect(migratedDirect.isDemo).toBe(true);
    expect(migratedDirect.session?.goal).toEqual({ name: 'Emergency fund', targetCents: 250000 });
    expect(migratedDirect.session?.expenses[0]).toMatchObject({
      id: id1,
      merchant: 'Netflix',
      priceCents: 1549,
      targetPriceCents: 1199,
      decision: 'negotiate',
      actionStatus: 'completed',
      reportedNewPriceCents: 1299,
      completedAt: NOW,
      notes: 'Retention offer accepted',
      transactionIds: [],
    });

    // Full Zustand store hydration & write-back from localStorage v2 -> v3 under same STORAGE_KEY
    ls.setItem(STORAGE_KEY, JSON.stringify(legacyV2));
    const mod = await import('@/lib/store');
    const state = mod.useAuditStore.getState();
    expect(state.isDemo).toBe(false);
    expect(state.session?.goal).toEqual({ name: 'Emergency fund', targetCents: 250000 });
    expect(state.session?.expenses).toHaveLength(2);
    expect(state.session?.expenses[0]).toMatchObject({
      id: id1,
      priceCents: 1549,
      targetPriceCents: 1199,
      decision: 'negotiate',
      actionStatus: 'completed',
      reportedNewPriceCents: 1299,
      completedAt: NOW,
      notes: 'Retention offer accepted',
      transactionIds: [],
    });
    expect(state.session?.expenses[1]).toMatchObject({
      id: id2,
      decision: 'keep',
      transactionIds: [],
    });

    const rewrittenRaw = ls.getItem(STORAGE_KEY)!;
    expect(rewrittenRaw).not.toContain('TXN-SECRET');
    expect(rewrittenRaw).not.toContain('ACCT-99887766');
    const rewritten = JSON.parse(rewrittenRaw);
    expect(rewritten.version).toBe(3);
  });

  it('sanitizePersisted always strips transactionIds regardless of stored contents and is idempotent', () => {
    const dirty = {
      isDemo: true,
      session: {
        version: 1,
        id: 's-dirty',
        createdAt: NOW,
        updatedAt: NOW,
        goal: { name: 'Summer trip', targetCents: 100000 },
        expenses: [
          makeExpense({
            transactionIds: ['TXN-SECRET-111', 'TXN-SECRET-222', 'OTHER-BANK-ID'],
            decision: 'negotiate',
            targetPriceCents: 1200,
            actionStatus: 'completed',
            reportedNewPriceCents: 1299,
            completedAt: NOW,
            notes: 'keep notes',
          }),
        ],
      },
    };

    const once = sanitizePersisted(dirty);
    expect(once.session?.expenses[0].transactionIds).toEqual([]);
    expect(JSON.stringify(once)).not.toContain('TXN-SECRET');
    expect(JSON.stringify(once)).not.toContain('OTHER-BANK-ID');
    expect(once.session?.expenses[0]).toMatchObject({
      decision: 'negotiate',
      targetPriceCents: 1200,
      actionStatus: 'completed',
      reportedNewPriceCents: 1299,
      completedAt: NOW,
      notes: 'keep notes',
    });

    const twice = sanitizePersisted(once);
    expect(twice).toEqual(once);
  });
});
