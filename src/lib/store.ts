'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { computeTotals } from '@/lib/engine/money';
import { DEMO_EXPENSES, DEMO_GOAL } from '@/lib/fixtures/miller';
import type {
  ActionStatus,
  AuditSession,
  Decision,
  Expense,
  FamilyGoal,
  Totals,
} from '@/lib/types';

export const STORAGE_KEY = 'familycut:audit:v1';

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
  updateExpense: (id: string, patch: Partial<Omit<Expense, 'id'>>) => void;
  removeExpense: (id: string) => void;
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
      const patchExpense = (id: string, patch: Partial<Omit<Expense, 'id'>>) =>
        mutate((s) => ({
          ...s,
          expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        }));

      return {
        session: null,
        isDemo: false,

        startSession: (expenses, { isDemo }) =>
          set({ session: newSession(expenses), isDemo }),

        loadDemo: () =>
          set({
            session: newSession(
              DEMO_EXPENSES.map((e) => ({ ...e, reasons: [...e.reasons], flags: [...e.flags] })),
              { ...DEMO_GOAL },
            ),
            isDemo: true,
          }),

        addExpense: (input) => {
          const id = input.id ?? uid();
          const expense: Expense = {
            category: 'Other',
            confidence: 'manual',
            reasons: ['Added manually'],
            flags: [],
            transactionIds: [],
            decision: 'undecided',
            actionStatus: 'not_started',
            ...input,
            id,
          };
          if (!get().session) {
            set({ session: newSession([expense]), isDemo: false });
          } else {
            mutate((s) => ({ ...s, expenses: [...s.expenses, expense] }));
          }
          return id;
        },

        updateExpense: (id, patch) => patchExpense(id, patch),

        removeExpense: (id) =>
          mutate((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) })),

        setDecision: (id, decision) => patchExpense(id, { decision }),

        setTargetPrice: (id, cents) => patchExpense(id, { targetPriceCents: cents }),

        setActionStatus: (id, status, reportedNewPriceCents) =>
          patchExpense(id, {
            actionStatus: status,
            reportedNewPriceCents: status === 'completed' ? reportedNewPriceCents : undefined,
            completedAt: status === 'completed' ? now() : undefined,
          }),

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
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ session: s.session, isDemo: s.isDemo }),
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
