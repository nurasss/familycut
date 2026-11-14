'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  applyActionStatus,
  applyDecision,
  applyExpensePatch,
  type ExpensePatch,
} from '@/lib/engine/lifecycle';
import { computeTotals } from '@/lib/engine/money';
import { DEMO_EXPENSES, DEMO_GOAL } from '@/lib/fixtures/miller';
import {
  STORAGE_KEY,
  STORAGE_VERSION,
  migratePersisted,
  sanitizePersisted,
  stripTransactionIds,
} from '@/lib/persisted-state';
import type {
  ActionStatus,
  AuditSession,
  Decision,
  Expense,
  FamilyGoal,
  Totals,
} from '@/lib/types';

export { STORAGE_KEY, STORAGE_VERSION, migratePersisted, sanitizePersisted, stripTransactionIds };

/** Minimum fields to add an expense manually; the rest gets defaults. */
export type NewExpense = Pick<Expense, 'merchant' | 'priceCents' | 'frequency'> &
  Partial<Omit<Expense, 'merchant' | 'priceCents' | 'frequency'>>;

type State = {
  session: AuditSession | null;
  isDemo: boolean;
};

type Actions = {
  startSession: (expenses: Expense[], opts: { isDemo: boolean }) => void;
  loadDemo: () => void;
  /** Returns the id of the created expense. Creates a session if none exists. */
  addExpense: (input: NewExpense) => string;
  /** Partial update. A changed decision / original price / frequency resets the execution state (see engine/lifecycle). */
  updateExpense: (id: string, patch: ExpensePatch) => void;
  removeExpense: (id: string) => void;
  /** Changing the decision resets the action status and reported price; setting the same decision is a no-op. */
  setDecision: (id: string, decision: Decision) => void;
  setTargetPrice: (id: string, cents: number | undefined) => void;
  setActionStatus: (id: string, status: ActionStatus, reportedNewPriceCents?: number) => void;
  setGoal: (goal: FamilyGoal | undefined) => void;
  /** Clears the store and localStorage completely. */
  deleteAllData: () => void;
};

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const now = () => new Date().toISOString();

function newSession(expenses: Expense[], goal?: FamilyGoal): AuditSession {
  const ts = now();
  return { version: 1, id: uid(), createdAt: ts, updatedAt: ts, expenses, goal };
}

export const useAuditStore = create<State & Actions>()(
  persist(
    (set, get) => {
      const mutate = (fn: (s: AuditSession) => AuditSession) => {
        const s = get().session;
        if (!s) return;
        set({ session: { ...fn(s), updatedAt: now() } });
      };
      const change = (id: string, fn: (e: Expense) => Expense) => {
        const s = get().session;
        const current = s?.expenses.find((e) => e.id === id);
        if (!current) return;
        const updated = fn(current);
        if (updated === current) return; // nothing changed
        mutate((sess) => ({
          ...sess,
          expenses: sess.expenses.map((e) => (e.id === id ? updated : e)),
        }));
      };

      return {
        session: null,
        isDemo: false,

        startSession: (expenses, { isDemo }) =>
          set({ session: newSession(stripTransactionIds(expenses)), isDemo }),

        loadDemo: () =>
          set({
            session: newSession(
              stripTransactionIds(
                DEMO_EXPENSES.map((e) => ({ ...e, reasons: [...e.reasons], flags: [...e.flags] })),
              ),
              { ...DEMO_GOAL },
            ),
            isDemo: true,
          }),

        addExpense: (input) => {
          const id = input.id ?? uid();
          const [expense] = stripTransactionIds([
            {
              category: 'Other',
              confidence: 'manual',
              reasons: ['Added manually'],
              flags: [],
              transactionIds: [],
              decision: 'undecided',
              actionStatus: 'not_started',
              ...input,
              id,
            },
          ]);
          if (!get().session) {
            set({ session: newSession([expense]), isDemo: false });
          } else {
            mutate((s) => ({ ...s, expenses: [...s.expenses, expense] }));
          }
          return id;
        },

        updateExpense: (id, patch) =>
          change(id, (e) => {
            const updated = applyExpensePatch(e, patch);
            return updated.transactionIds.length === 0 ? updated : stripTransactionIds([updated])[0];
          }),

        removeExpense: (id) =>
          mutate((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) })),

        setDecision: (id, decision) => change(id, (e) => applyDecision(e, decision)),

        setTargetPrice: (id, cents) => change(id, (e) => applyExpensePatch(e, { targetPriceCents: cents })),

        setActionStatus: (id, status, reportedNewPriceCents) =>
          change(id, (e) => applyActionStatus(e, status, reportedNewPriceCents)),

        setGoal: (goal) => mutate((s) => ({ ...s, goal })),

        deleteAllData: () => {
          set({ session: null, isDemo: false });
          useAuditStore.persist.clearStorage();
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* storage unavailable */
          }
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate: (persisted, version) => migratePersisted(persisted, version) as State & Actions,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ session: s.session, isDemo: s.isDemo }),
      // Validates persisted state and drops orphaned execution state; idempotent, so it is safe on every load.
      merge: (persisted, current) => {
        const safe = sanitizePersisted(persisted);
        return {
          ...current,
          ...(Object.prototype.hasOwnProperty.call(safe, 'session') ? { session: safe.session } : {}),
          ...(Object.prototype.hasOwnProperty.call(safe, 'isDemo') ? { isDemo: safe.isDemo } : {}),
        };
      },
    },
  ),
);

/** Derived totals (recurring / potential / reported + goal %). */
export function useTotals(): Totals {
  const session = useAuditStore((s) => s.session);
  return useMemo(
    () => computeTotals(session?.expenses ?? [], session?.goal),
    [session],
  );
}
