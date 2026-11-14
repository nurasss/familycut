"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Printer, Sparkles } from "lucide-react";
import { annualCents } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import { SAMPLE_DATA_LABEL } from "@/lib/fixtures/miller";
import { useAuditStore, useTotals } from "@/lib/store";
import type { Decision } from "@/lib/types";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { FamilyGoalCard } from "@/components/results/family-goal-card";
import { ExpenseCard } from "@/components/results/expense-card";
import { getReviewCandidates } from "@/components/audit/import-adapter";
import { SampleDataBadge } from "@/components/ui-badges";
import { TryDemoConfirmDialog } from "@/components/demo/try-demo-confirm-dialog";
import { useTryDemo } from "@/components/demo/use-try-demo";
import { useHasHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

type FilterKey = "all" | Decision;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "undecided", label: "Undecided" },
  { key: "cut", label: "Cut" },
  { key: "negotiate", label: "Negotiate" },
  { key: "keep", label: "Keep" },
  { key: "not_recurring", label: "Not recurring" },
];

export default function ResultsPage() {
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const { requestTryDemo, dialogProps: tryDemoDialogProps } = useTryDemo({
    redirectTo: null,
  });
  const setDecision = useAuditStore((s) => s.setDecision);
  const setTargetPrice = useAuditStore((s) => s.setTargetPrice);
  const updateExpense = useAuditStore((s) => s.updateExpense);
  const totals = useTotals();

  const [filter, setFilter] = useState<FilterKey>("all");

  const expenses = session?.expenses ?? [];
  const reviewCandidates = getReviewCandidates(expenses, 3);
  const actionableCount = expenses.filter(
    (e) => e.decision === "cut" || e.decision === "negotiate",
  ).length;

  const filteredExpenses =
    filter === "all"
      ? expenses
      : expenses.filter((e) => e.decision === filter);

  const confirmedOrTrustedExpenses = filteredExpenses.filter(
    (e) => !(e.confidence === "low" && e.decision === "undecided"),
  );
  const needsReviewExpenses = filteredExpenses.filter(
    (e) => e.confidence === "low" && e.decision === "undecided",
  );

  const countForFilter = (key: FilterKey) =>
    key === "all"
      ? expenses.length
      : expenses.filter((e) => e.decision === key).length;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="app" currentStep={2} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {!hydrated ? (
          <div className="space-y-6" aria-busy="true" aria-label="Loading audit">
            <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="h-28 animate-pulse rounded-xl bg-muted" />
              <div className="h-28 animate-pulse rounded-xl bg-muted" />
              <div className="h-28 animate-pulse rounded-xl bg-muted" />
            </div>
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : !session || expenses.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="text-2xl font-extrabold text-foreground">
              No expenses in this audit yet
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Add your recurring bills manually, paste statement lines, or load
              a CSV file in your browser. Or explore with sample data first.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/audit"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Add expenses
              </Link>
              <button
                type="button"
                onClick={requestTryDemo}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Try demo
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Title row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                    Review recurring expenses
                  </h1>
                  {isDemo && (
                    <SampleDataBadge aria-label={SAMPLE_DATA_LABEL} />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose Keep, Cut, Negotiate, or Not recurring for each bill.
                  Changes recalculate immediately.
                </p>
              </div>
              <div className="no-print flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <Printer className="size-4" aria-hidden="true" />
                  <span>Print / Save as PDF</span>
                </button>
                <Link
                  href="/audit"
                  className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Add more bills
                </Link>
              </div>
            </div>

            {/* Three independent metric cards (§8.2) */}
            <section
              aria-label="Annual financial summary"
              className="print-card-grid grid grid-cols-1 gap-4 md:grid-cols-3"
            >
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Recurring spend / year
                </p>
                <p className="mt-2 text-3xl font-extrabold text-foreground tabular-nums">
                  {formatUsd(totals.recurringAnnualCents)}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Confirmed recurring bills and trusted subscriptions at annual
                  rate.
                </p>
              </div>

              <div className="rounded-xl border border-[#BBF7D0] bg-[var(--savings-bg)] p-5">
                <p className="text-xs font-semibold tracking-wide text-primary uppercase">
                  Potential annual savings (estimate)
                </p>
                <p className="mt-2 text-3xl font-extrabold text-[var(--savings)] tabular-nums">
                  {formatUsd(totals.potentialAnnualCents)}
                </p>
                <p className="mt-1.5 text-xs text-primary/90">
                  From the Cut and Negotiate choices with a target price.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Self-reported annual savings (not bank-verified)
                </p>
                <p className="mt-2 text-3xl font-extrabold text-foreground tabular-nums">
                  {formatUsd(totals.reportedAnnualCents)}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Completed actions you confirmed with a new price on Step 3.
                </p>
              </div>
            </section>

            {/* Main 2-column content: Goal sidebar first in mobile flow? Right on desktop, above list on mobile */}
            <div className="print-single-col grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="order-1 lg:order-2 lg:col-span-4">
                <FamilyGoalCard
                  goal={session.goal}
                  totals={totals}
                  actionableCount={actionableCount}
                />
              </div>

              <div className="order-2 space-y-8 lg:order-1 lg:col-span-8">
                {/* Review first strip (FR-11) */}
                {reviewCandidates.length > 0 && (
                  <section
                    aria-labelledby="review-first-heading"
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                      <h2
                        id="review-first-heading"
                        className="text-base font-bold text-foreground"
                      >
                        Review first
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Highest-impact undecided or flagged bills to check first.
                      Nothing is cut automatically.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {reviewCandidates.map((cand) => (
                        <div
                          key={cand.id}
                          className="flex flex-col justify-between rounded-lg border border-border bg-background/70 p-3.5"
                        >
                          <div>
                            <p className="truncate text-sm font-bold text-foreground">
                              {cand.merchant}
                            </p>
                            <p className="mt-0.5 text-sm font-extrabold text-foreground tabular-nums">
                              {formatUsd(
                                annualCents(cand.priceCents, cand.frequency),
                              )}
                              /yr
                            </p>
                            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                              {cand.reasons.join(" · ")}
                            </p>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(["keep", "cut", "negotiate"] as const).map(
                              (choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  onClick={() => setDecision(cand.id, choice)}
                                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground capitalize hover:bg-muted"
                                >
                                  {choice}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Full expense list with filters */}
                <section aria-labelledby="expenses-list-heading">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <h2
                      id="expenses-list-heading"
                      className="text-lg font-bold text-foreground"
                    >
                      Recurring expenses ({expenses.length})
                    </h2>

                    <div
                      role="group"
                      aria-label="Filter expenses by decision"
                      className="no-print flex flex-wrap gap-1.5"
                    >
                      {FILTERS.map((f) => {
                        const count = countForFilter(f.key);
                        const active = filter === f.key;
                        return (
                          <button
                            key={f.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setFilter(f.key)}
                            className={cn(
                              "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors tabular-nums",
                              active
                                ? "border-primary bg-primary text-primary-foreground font-semibold"
                                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {f.label} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {filteredExpenses.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
                      <p className="text-sm font-medium text-foreground">
                        No expenses match this filter
                      </p>
                      <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-xs font-semibold text-foreground hover:bg-muted"
                      >
                        Show all ({expenses.length})
                      </button>
                    </div>
                  ) : (
                    <>
                      {confirmedOrTrustedExpenses.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {confirmedOrTrustedExpenses.map((expense) => (
                            <ExpenseCard
                              key={expense.id}
                              expense={expense}
                              onDecisionChange={setDecision}
                              onTargetPriceChange={setTargetPrice}
                              onUpdateExpense={updateExpense}
                            />
                          ))}
                        </div>
                      )}

                      {needsReviewExpenses.length > 0 && (
                        <details className="group mt-4 rounded-xl border border-border bg-card">
                          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-foreground">
                                Needs your review ({needsReviewExpenses.length})
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Not counted in recurring spend until you confirm
                              </p>
                            </div>
                            <ChevronDown
                              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                              aria-hidden="true"
                            />
                          </summary>
                          <div className="space-y-3 border-t border-border p-4 sm:p-5">
                            {needsReviewExpenses.map((expense) => (
                              <ExpenseCard
                                key={expense.id}
                                expense={expense}
                                onDecisionChange={setDecision}
                                onTargetPriceChange={setTargetPrice}
                                onUpdateExpense={updateExpense}
                              />
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </section>
              </div>
            </div>
          </div>
        )}
      </main>

      <TryDemoConfirmDialog {...tryDemoDialogProps} />

      <SiteFooter />
    </div>
  );
}
