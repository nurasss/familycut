"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, Pencil, Target } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { useAuditStore } from "@/lib/store";
import type { FamilyGoal, Totals } from "@/lib/types";
import {
  centsToInputValue,
  parsePriceInputToCents,
} from "@/components/money-input";

type FamilyGoalCardProps = {
  goal?: FamilyGoal;
  totals: Totals;
  actionableCount: number;
};

export function FamilyGoalCard({
  goal,
  totals,
  actionableCount,
}: FamilyGoalCardProps) {
  const uid = useId();
  const setGoal = useAuditStore((s) => s.setGoal);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(goal?.name ?? "Family trip");
  const [amountInput, setAmountInput] = useState(
    goal ? centsToInputValue(goal.targetCents) : "1500.00",
  );
  const [error, setError] = useState<string | null>(null);

  const plannedPct = Math.round(totals.plannedGoalPct);
  const reportedPct = Math.round(totals.reportedGoalPct);
  const goalName = goal?.name || "family goal";

  const openEditor = () => {
    setNameInput(goal?.name ?? "Family trip");
    setAmountInput(goal ? centsToInputValue(goal.targetCents) : "1500.00");
    setError(null);
    setEditing(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    const cents = parsePriceInputToCents(amountInput);
    if (!trimmed) {
      setError("Enter a goal name");
      return;
    }
    if (cents === null || cents <= 0) {
      setError("Enter a target dollar amount greater than $0");
      return;
    }
    setGoal({ name: trimmed, targetCents: cents });
    setEditing(false);
    setError(null);
  };

  return (
    <aside
      aria-label="Family goal and action plan"
      className="print-avoid-break rounded-xl border border-border bg-card p-5 lg:sticky lg:top-32"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--savings-bg)] text-primary">
            <Target className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-foreground">Family goal</h2>
            {goal && !editing && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {goal.name} · {formatUsd(goal.targetCents)}
              </p>
            )}
          </div>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            className="no-print inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-muted"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            <span>{goal ? "Edit" : "Set goal"}</span>
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="mt-4 space-y-3" noValidate>
          <div>
            <label
              htmlFor={`${uid}-goal-name`}
              className="block text-xs font-medium text-foreground"
            >
              Goal name
            </label>
            <input
              id={`${uid}-goal-name`}
              type="text"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Family trip"
              maxLength={60}
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
            />
          </div>

          <div>
            <label
              htmlFor={`${uid}-goal-amount`}
              className="block text-xs font-medium text-foreground"
            >
              Target amount ($)
            </label>
            <input
              id={`${uid}-goal-amount`}
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                if (error) setError(null);
              }}
              placeholder="1500.00"
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-[var(--chip-cut)]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {goal ? (
              <button
                type="button"
                onClick={() => {
                  setGoal(undefined);
                  setEditing(false);
                }}
                className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clear goal
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground"
              >
                Save goal
              </button>
            </div>
          </div>
        </form>
      ) : goal ? (
        <div className="mt-4 space-y-4">
          {/* Planned savings progress */}
          <div>
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="text-foreground">Planned savings progress</span>
              <span className="text-[var(--savings)] tabular-nums">
                {plannedPct}%
              </span>
            </div>
            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={plannedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Planned progress toward ${goal.name}`}
            >
              <div
                className="h-full rounded-full bg-[var(--savings)] transition-all"
                style={{ width: `${plannedPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Your planned cuts could cover{" "}
              <strong className="font-semibold text-foreground tabular-nums">
                {plannedPct}%
              </strong>{" "}
              of your {goalName}.
            </p>
          </div>

          {/* Separate thin self-reported progress */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">
                Self-reported progress {reportedPct}%
              </span>
              <span className="text-[11px] text-muted-foreground">
                Not bank-verified
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={reportedPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Self-reported progress toward ${goal.name}`}
            >
              <div
                className="h-full rounded-full bg-foreground transition-all"
                style={{ width: `${reportedPct}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-background/60 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Add a family goal (like a trip or emergency fund) to see how your
            planned cuts compare.
          </p>
          <button
            type="button"
            onClick={openEditor}
            className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
          >
            Set a family goal
          </button>
        </div>
      )}

      <div className="no-print mt-5 border-t border-border pt-4">
        <Link
          href="/action"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
        >
          <span>Open action plan ({actionableCount})</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        {actionableCount === 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Mark at least one expense as Cut or Negotiate to generate scripts.
          </p>
        )}
      </div>
    </aside>
  );
}
