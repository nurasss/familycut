"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { annualCents } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import { useAuditStore } from "@/lib/store";
import type { Expense, Frequency } from "@/lib/types";
import {
  FREQUENCY_LABEL,
  FREQUENCY_SHORT,
  centsToInputValue,
  parsePriceInputToCents,
} from "@/components/money-input";
import { useHasHydrated } from "@/components/use-hydrated";

const FREQUENCIES: Exclude<Frequency, "unknown">[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

const CATEGORIES = [
  "Entertainment",
  "Health & fitness",
  "Utilities",
  "Software",
  "Insurance",
  "Subscriptions",
  "Other",
];

function ManualExpenseRow({
  expense,
  onUpdate,
  onRemove,
}: {
  expense: Expense;
  onUpdate: (id: string, patch: Partial<Omit<Expense, "id">>) => void;
  onRemove: (id: string) => void;
}) {
  const uid = useId();
  const [merchant, setMerchant] = useState(expense.merchant);
  const [priceStr, setPriceStr] = useState(
    centsToInputValue(expense.priceCents),
  );
  const [priceError, setPriceError] = useState<string | null>(null);

  const commitMerchant = () => {
    const trimmed = merchant.trim();
    if (trimmed && trimmed !== expense.merchant) {
      onUpdate(expense.id, { merchant: trimmed });
    } else if (!trimmed) {
      setMerchant(expense.merchant);
    }
  };

  const commitPrice = () => {
    const cents = parsePriceInputToCents(priceStr);
    if (cents === null || cents <= 0) {
      setPriceError("Enter a valid dollar amount");
      return;
    }
    setPriceError(null);
    setPriceStr(centsToInputValue(cents));
    if (cents !== expense.priceCents) {
      onUpdate(expense.id, { priceCents: cents });
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
        <div className="sm:col-span-4">
          <label
            htmlFor={`${uid}-merchant`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Merchant or service
          </label>
          <input
            id={`${uid}-merchant`}
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            onBlur={commitMerchant}
            maxLength={80}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          />
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={`${uid}-price`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Price ($)
          </label>
          <input
            id={`${uid}-price`}
            type="text"
            inputMode="decimal"
            value={priceStr}
            onChange={(e) => {
              setPriceStr(e.target.value);
              if (priceError) setPriceError(null);
            }}
            onBlur={commitPrice}
            aria-invalid={priceError ? "true" : undefined}
            aria-describedby={priceError ? `${uid}-price-err` : undefined}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums"
          />
          {priceError && (
            <p
              id={`${uid}-price-err`}
              className="mt-1 text-xs text-[var(--chip-cut)]"
            >
              {priceError}
            </p>
          )}
        </div>

        <div className="sm:col-span-3">
          <label
            htmlFor={`${uid}-freq`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Frequency
          </label>
          <select
            id={`${uid}-freq`}
            value={expense.frequency}
            onChange={(e) =>
              onUpdate(expense.id, { frequency: e.target.value as Frequency })
            }
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABEL[f]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={`${uid}-cat`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Category
          </label>
          <select
            id={`${uid}-cat`}
            value={
              CATEGORIES.includes(expense.category) ? expense.category : "Other"
            }
            onChange={(e) => onUpdate(expense.id, { category: e.target.value })}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
          <span className="text-xs text-muted-foreground tabular-nums sm:hidden">
            {formatUsd(annualCents(expense.priceCents, expense.frequency))}/yr
          </span>
          <button
            type="button"
            onClick={() => onRemove(expense.id)}
            aria-label={`Remove ${expense.merchant}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-[var(--chip-cut)] hover:text-[var(--chip-cut)]"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="mt-2 hidden text-xs text-muted-foreground tabular-nums sm:block">
        {formatUsd(expense.priceCents)}/{FREQUENCY_SHORT[expense.frequency]} ·{" "}
        {formatUsd(annualCents(expense.priceCents, expense.frequency))} annual
        equivalent
      </p>
    </li>
  );
}

export function ManualTab() {
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const startSession = useAuditStore((s) => s.startSession);
  const addExpense = useAuditStore((s) => s.addExpense);
  const updateExpense = useAuditStore((s) => s.updateExpense);
  const removeExpense = useAuditStore((s) => s.removeExpense);

  const [merchant, setMerchant] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [frequency, setFrequency] =
    useState<Exclude<Frequency, "unknown">>("monthly");
  const [category, setCategory] = useState("Entertainment");
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const expenses = hydrated && session && !isDemo ? session.expenses : [];

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMerchant = merchant.trim();
    const cents = parsePriceInputToCents(priceInput);

    let hasError = false;
    if (!trimmedMerchant) {
      setMerchantError("Enter a merchant or service name");
      hasError = true;
    }
    if (cents === null || cents <= 0) {
      setPriceError("Enter a valid dollar price, e.g. 15.49");
      hasError = true;
    }
    if (hasError || cents === null) return;

    if (isDemo) {
      startSession([], { isDemo: false });
    }

    addExpense({
      merchant: trimmedMerchant,
      priceCents: cents,
      frequency,
      category,
    });

    setMerchant("");
    setPriceInput("");
    setMerchantError(null);
    setPriceError(null);
  };

  return (
    <div className="space-y-6">
      {hydrated && isDemo && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-muted/60 p-4 sm:flex-row sm:items-center">
          <p className="text-sm text-foreground">
            Sample demo data is currently loaded. Adding an expense below will
            start a clean audit for your household.
          </p>
          <button
            type="button"
            onClick={() => startSession([], { isDemo: false })}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
          >
            Start empty list
          </button>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        aria-labelledby="manual-form-heading"
        className="rounded-xl border border-border bg-card p-5"
        noValidate
      >
        <h2
          id="manual-form-heading"
          className="text-base font-bold text-foreground"
        >
          Add a recurring bill or subscription
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter amounts in USD. Entries are saved locally in your browser;
          optional AI script generation only sends one selected bill&apos;s
          summary fields.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-12">
          <div className="sm:col-span-4">
            <label
              htmlFor="manual-merchant"
              className="block text-sm font-medium text-foreground"
            >
              Merchant <span aria-hidden="true">*</span>
            </label>
            <input
              id="manual-merchant"
              name="merchant"
              type="text"
              required
              maxLength={80}
              placeholder="e.g. Netflix, Internet, Gym"
              value={merchant}
              onChange={(e) => {
                setMerchant(e.target.value);
                if (merchantError) setMerchantError(null);
              }}
              aria-invalid={merchantError ? "true" : undefined}
              aria-describedby={merchantError ? "manual-merchant-err" : undefined}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/70"
            />
            {merchantError && (
              <p
                id="manual-merchant-err"
                role="alert"
                className="mt-1 text-xs text-[var(--chip-cut)]"
              >
                {merchantError}
              </p>
            )}
          </div>

          <div className="sm:col-span-3">
            <label
              htmlFor="manual-price"
              className="block text-sm font-medium text-foreground"
            >
              Price ($) <span aria-hidden="true">*</span>
            </label>
            <input
              id="manual-price"
              name="price"
              type="text"
              inputMode="decimal"
              required
              placeholder="15.49"
              value={priceInput}
              onChange={(e) => {
                setPriceInput(e.target.value);
                if (priceError) setPriceError(null);
              }}
              aria-invalid={priceError ? "true" : undefined}
              aria-describedby={priceError ? "manual-price-err" : undefined}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground tabular-nums placeholder:text-muted-foreground/70"
            />
            {priceError && (
              <p
                id="manual-price-err"
                role="alert"
                className="mt-1 text-xs text-[var(--chip-cut)]"
              >
                {priceError}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="manual-frequency"
              className="block text-sm font-medium text-foreground"
            >
              Frequency
            </label>
            <select
              id="manual-frequency"
              name="frequency"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as Exclude<Frequency, "unknown">)
              }
              className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label
              htmlFor="manual-category"
              className="block text-sm font-medium text-foreground"
            >
              Category
            </label>
            <select
              id="manual-category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Add expense</span>
          </button>
        </div>
      </form>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">
            Your manual list ({expenses.length})
          </h3>
          {expenses.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Edit any row inline before analyzing
            </span>
          )}
        </div>

        {expenses.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No manual expenses added yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your streaming, internet, gym, or software bills above, or try
              sample demo data below.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {expenses.map((expense) => (
              <ManualExpenseRow
                key={expense.id}
                expense={expense}
                onUpdate={updateExpense}
                onRemove={removeExpense}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
