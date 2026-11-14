"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Pencil, X } from "lucide-react";
import { MULTIPLIER, annualCents } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import type { Decision, Expense, Frequency, SystemFlag } from "@/lib/types";
import {
  FREQUENCY_LABEL,
  FREQUENCY_SHORT,
  centsToInputValue,
  parsePriceInputToCents,
} from "@/components/money-input";
import { ConfidencePill } from "@/components/ui-badges";
import { cn } from "@/lib/utils";

const DECISIONS: { value: Decision; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "cut", label: "Cut" },
  { value: "negotiate", label: "Negotiate" },
  { value: "not_recurring", label: "Not recurring" },
];

const FREQUENCIES: Frequency[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "unknown",
];

const FLAG_LABEL: Record<SystemFlag, string> = {
  duplicate_candidate: "Possible duplicate",
  price_increase: "Price increased",
  trial_ending_unknown: "Trial end unknown",
  review_price: "Review price",
  unclear_merchant: "Unclear merchant",
};

type ExpenseCardProps = {
  expense: Expense;
  highlightReviewReason?: string;
  onDecisionChange: (id: string, decision: Decision) => void;
  onTargetPriceChange: (id: string, cents: number | undefined) => void;
  onUpdateExpense: (id: string, patch: Partial<Omit<Expense, "id">>) => void;
};

export function ExpenseCard({
  expense,
  highlightReviewReason,
  onDecisionChange,
  onTargetPriceChange,
  onUpdateExpense,
}: ExpenseCardProps) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [merchantDraft, setMerchantDraft] = useState(expense.merchant);
  const [priceDraft, setPriceDraft] = useState(
    centsToInputValue(expense.priceCents),
  );
  const [freqDraft, setFreqDraft] = useState<Frequency>(expense.frequency);
  const [editError, setEditError] = useState<string | null>(null);

  const [targetInput, setTargetInput] = useState(
    centsToInputValue(expense.targetPriceCents),
  );
  const [targetError, setTargetError] = useState<string | null>(null);

  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const freqShort = FREQUENCY_SHORT[expense.frequency];
  const annual = annualCents(expense.priceCents, expense.frequency);

  const openEdit = () => {
    setMerchantDraft(expense.merchant);
    setPriceDraft(centsToInputValue(expense.priceCents));
    setFreqDraft(expense.frequency);
    setEditError(null);
    setEditing(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = merchantDraft.trim();
    const cents = parsePriceInputToCents(priceDraft);
    if (!trimmed) {
      setEditError("Merchant name cannot be empty");
      return;
    }
    if (cents === null || cents <= 0) {
      setEditError("Enter a valid dollar price");
      return;
    }
    onUpdateExpense(expense.id, {
      merchant: trimmed,
      priceCents: cents,
      frequency: freqDraft,
    });
    setEditing(false);
    setEditError(null);
  };

  const handleTargetChange = (raw: string) => {
    setTargetInput(raw);
    if (!raw.trim()) {
      setTargetError(null);
      onTargetPriceChange(expense.id, undefined);
      return;
    }
    const cents = parsePriceInputToCents(raw);
    if (cents === null) {
      setTargetError("Enter a valid dollar amount");
      return;
    }
    setTargetError(null);
    onTargetPriceChange(expense.id, cents);
  };

  const handleRadioKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % DECISIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + DECISIONS.length) % DECISIONS.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = DECISIONS.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const next = DECISIONS[nextIdx];
      onDecisionChange(expense.id, next.value);
      radioRefs.current[nextIdx]?.focus();
    }
  };

  const selectedRadioIndex = DECISIONS.findIndex(
    (d) => d.value === expense.decision,
  );

  const decisionButtonStyle = (val: Decision, active: boolean) => {
    if (!active) {
      return "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground";
    }
    switch (val) {
      case "keep":
        return "border-[var(--chip-keep)] bg-[var(--chip-keep-bg)] text-[var(--chip-keep)] font-semibold";
      case "cut":
        return "border-[var(--chip-cut)] bg-[var(--chip-cut-bg)] text-[var(--chip-cut)] font-semibold";
      case "negotiate":
        return "border-[var(--chip-negotiate)] bg-[var(--chip-negotiate-bg)] text-[var(--chip-negotiate)] font-semibold";
      case "not_recurring":
        return "border-foreground bg-muted text-foreground font-semibold";
      default:
        return "";
    }
  };

  const negotiateSavingsCents =
    expense.decision === "negotiate" &&
    expense.targetPriceCents !== undefined &&
    expense.targetPriceCents < expense.priceCents
      ? (expense.priceCents - expense.targetPriceCents) *
        MULTIPLIER[expense.frequency]
      : null;

  const reasons = highlightReviewReason
    ? [highlightReviewReason, ...expense.reasons]
    : expense.reasons;

  return (
    <article className="print-avoid-break rounded-xl border border-border bg-card p-4 sm:p-5">
      {!editing ? (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-foreground">
                {expense.merchant}
              </h3>
              <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground">
                {FREQUENCY_LABEL[expense.frequency]}
              </span>
              <ConfidencePill confidence={expense.confidence} />
              {expense.flags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  {FLAG_LABEL[flag]}
                </span>
              ))}
            </div>

            {reasons.length > 0 && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {reasons.join(" · ")}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
            <div className="text-left sm:text-right">
              <p className="text-lg font-extrabold text-foreground tabular-nums">
                {formatUsd(expense.priceCents)}
                <span className="text-xs font-medium text-muted-foreground">
                  /{freqShort}
                </span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {expense.frequency === "unknown"
                  ? "Annual unknown"
                  : `${formatUsd(annual)}/yr`}
              </p>
            </div>

            <button
              type="button"
              onClick={openEdit}
              aria-label={`Edit ${expense.merchant}`}
              className="no-print inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              <span>Edit</span>
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSaveEdit}
          className="space-y-3 rounded-lg border border-border bg-background/60 p-3.5"
          noValidate
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label
                htmlFor={`${uid}-edit-merchant`}
                className="block text-xs font-medium text-foreground"
              >
                Merchant
              </label>
              <input
                id={`${uid}-edit-merchant`}
                type="text"
                value={merchantDraft}
                onChange={(e) => setMerchantDraft(e.target.value)}
                maxLength={80}
                className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor={`${uid}-edit-price`}
                className="block text-xs font-medium text-foreground"
              >
                Price ($)
              </label>
              <input
                id={`${uid}-edit-price`}
                type="text"
                inputMode="decimal"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground tabular-nums"
              />
            </div>

            <div className="sm:col-span-4">
              <label
                htmlFor={`${uid}-edit-freq`}
                className="block text-xs font-medium text-foreground"
              >
                Frequency
              </label>
              <select
                id={`${uid}-edit-freq`}
                value={freqDraft}
                onChange={(e) => setFreqDraft(e.target.value as Frequency)}
                className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {editError && (
            <p role="alert" className="text-xs text-[var(--chip-cut)]">
              {editError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Cancel</span>
            </button>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground"
            >
              <Check className="size-3.5" aria-hidden="true" />
              <span>Save</span>
            </button>
          </div>
        </form>
      )}

      {/* Segmented control: Keep | Cut | Negotiate | Not recurring */}
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="radiogroup"
          aria-label={`Decision for ${expense.merchant}`}
          className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap"
        >
          {DECISIONS.map((opt, idx) => {
            const checked = expense.decision === opt.value;
            const tabIndex =
              checked || (selectedRadioIndex === -1 && idx === 0) ? 0 : -1;

            return (
              <button
                key={opt.value}
                ref={(el) => {
                  radioRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={tabIndex}
                onClick={() => onDecisionChange(expense.id, opt.value)}
                onKeyDown={(e) => handleRadioKeyDown(e, idx)}
                className={cn(
                  "inline-flex min-h-11 items-center justify-center rounded-full border px-3.5 text-xs transition-colors sm:text-sm",
                  decisionButtonStyle(opt.value, checked),
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {(expense.decision === "cut" || expense.decision === "negotiate") && (
          <Link
            href={`/action?id=${encodeURIComponent(expense.id)}`}
            className="no-print inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-[var(--savings-bg)]/60 px-3.5 text-xs font-semibold text-primary transition-colors hover:bg-[var(--savings-bg)]"
          >
            <span>Get script</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Negotiate inline target price */}
      {expense.decision === "negotiate" && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-[var(--chip-negotiate-bg)]/45 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={`${uid}-target`}
              className="text-xs font-medium text-foreground"
            >
              Target price ($ / {freqShort})
            </label>
            <input
              id={`${uid}-target`}
              type="text"
              inputMode="decimal"
              value={targetInput}
              onChange={(e) => handleTargetChange(e.target.value)}
              placeholder="60.00"
              aria-invalid={targetError ? "true" : undefined}
              className="min-h-11 w-28 rounded-lg border border-input bg-card px-3 text-sm text-foreground tabular-nums"
            />
          </div>

          <div className="text-xs font-medium">
            {targetError ? (
              <span className="text-[var(--chip-cut)]">{targetError}</span>
            ) : negotiateSavingsCents !== null ? (
              <span className="font-semibold text-[var(--savings)] tabular-nums">
                Saves {formatUsd(negotiateSavingsCents)}/yr (estimate)
              </span>
            ) : (
              <span className="text-muted-foreground">
                Add a target price to estimate savings
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
