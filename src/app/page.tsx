import Link from "next/link";
import {
  Copy,
  ListChecks,
  Lock,
  ShieldCheck,
  Tv,
  Dumbbell,
  Wifi,
  Upload,
} from "lucide-react";
import { computeTotals } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import {
  DEMO_EXPENSES,
  DEMO_GOAL,
  SAMPLE_DATA_LABEL,
} from "@/lib/fixtures/miller";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { TryDemoButton } from "@/components/landing/try-demo-button";
import { DecisionChip, SampleDataBadge } from "@/components/ui-badges";
import { FREQUENCY_SHORT } from "@/components/money-input";

export default function HomePage() {
  const demoTotals = computeTotals(DEMO_EXPENSES, DEMO_GOAL);
  const plannedPct = Math.round(demoTotals.plannedGoalPct);
  const featuredExpenses = DEMO_EXPENSES.filter(
    (e) => e.decision === "cut" || e.decision === "negotiate",
  );

  const iconForExpense = (id: string) => {
    if (id.includes("streaming")) return Tv;
    if (id.includes("fitness")) return Dumbbell;
    return Wifi;
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="landing" />

      <main className="flex-1">
        {/* Hero section */}
        <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
            {/* Hero left */}
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <Lock className="size-3.5 text-primary" aria-hidden="true" />
                <span>Private in-browser utility for households</span>
              </div>

              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[1.06]">
                Find the bills you can cut. Keep the money your family needs.
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Review recurring expenses, choose what to cancel or negotiate,
                and get the exact next step. No bank connection required.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/audit"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
                >
                  Start free audit
                </Link>
                <TryDemoButton />
              </div>

              <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  No signup. No bank login. Your CSV stays in your browser.
                </span>
              </p>
            </div>

            {/* Hero right: Sample audit preview card */}
            <div className="lg:col-span-6">
              <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
                  <p className="font-[family-name:var(--font-heading)] text-base font-bold text-foreground">
                    Household Bill Audit
                  </p>
                  <SampleDataBadge />
                </div>

                {/* Three separate metrics */}
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-background/70 p-3.5">
                    <p className="text-xs font-medium leading-snug text-muted-foreground">
                      Recurring spend / year
                    </p>
                    <p className="mt-1.5 text-lg font-bold text-foreground tabular-nums">
                      {formatUsd(demoTotals.recurringAnnualCents)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-[#BBF7D0] bg-[var(--savings-bg)] p-3.5">
                    <p className="text-xs font-medium leading-snug text-primary">
                      Potential annual savings (estimate)
                    </p>
                    <p className="mt-1.5 text-lg font-bold text-[var(--savings)] tabular-nums">
                      {formatUsd(demoTotals.potentialAnnualCents)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-background/70 p-3.5">
                    <p className="text-xs font-medium leading-snug text-muted-foreground">
                      Self-reported annual savings (not bank-verified)
                    </p>
                    <p className="mt-1.5 text-lg font-bold text-foreground tabular-nums">
                      {formatUsd(demoTotals.reportedAnnualCents)}
                    </p>
                  </div>
                </div>

                {/* Audited subscriptions preview */}
                <div className="mt-5">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Audited subscriptions ({SAMPLE_DATA_LABEL})
                  </p>
                  <ul className="mt-2.5 space-y-2.5">
                    {featuredExpenses.map((expense) => {
                      const Icon = iconForExpense(expense.id);
                      const freq = FREQUENCY_SHORT[expense.frequency];
                      return (
                        <li
                          key={expense.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {expense.merchant}
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {expense.decision === "negotiate" &&
                                expense.targetPriceCents !== undefined
                                  ? `${formatUsd(expense.priceCents)} → ${formatUsd(expense.targetPriceCents)}/${freq}`
                                  : `${formatUsd(expense.priceCents)}/${freq}`}
                              </p>
                            </div>
                          </div>
                          <DecisionChip decision={expense.decision} />
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Goal bar */}
                <div className="mt-5 border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="text-foreground">
                      Target: {DEMO_GOAL.name}
                    </span>
                    <span className="text-[var(--savings)] tabular-nums">
                      {plannedPct}%
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={plannedPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${DEMO_GOAL.name} planned savings progress`}
                  >
                    <div
                      className="h-full rounded-full bg-[var(--savings)]"
                      style={{ width: `${plannedPct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your planned cuts could cover{" "}
                    <strong className="font-semibold text-foreground">
                      {plannedPct}%
                    </strong>{" "}
                    of your {DEMO_GOAL.name}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="border-t border-border bg-card py-14 sm:py-16"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              How it works
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              A private three-step workflow designed to take less than 5
              minutes. No passwords or account syncs ever needed.
            </p>

            <ol className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
              <li className="flex flex-col justify-between rounded-xl border border-border bg-background/50 p-6">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums">
                      1
                    </span>
                    <Upload
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-foreground">
                    Add expenses
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Manually list your recurring accounts, paste copied line
                    items, or drop in a standard statement CSV file.
                  </p>
                </div>
                <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
                  Flexible input: CSV, paste, or direct edit
                </p>
              </li>

              <li className="flex flex-col justify-between rounded-xl border border-border bg-background/50 p-6">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums">
                      2
                    </span>
                    <ListChecks
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-foreground">
                    Review recurring charges
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Categorize each detected subscription in seconds using
                    simple decision chips: Keep, Cut, or Negotiate.
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap gap-1.5 border-t border-border pt-3">
                  <DecisionChip decision="keep" />
                  <DecisionChip decision="cut" />
                  <DecisionChip decision="negotiate" />
                </div>
              </li>

              <li className="flex flex-col justify-between rounded-xl border border-border bg-background/50 p-6">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums">
                      3
                    </span>
                    <Copy
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-foreground">
                    Copy your next step
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Get pre-filled cancellation notices or copy word-for-word
                    retention negotiation scripts to use yourself.
                  </p>
                </div>
                <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
                  Ready-to-copy templates &amp; email drafts
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* Privacy band */}
        <section className="border-t border-border bg-background py-12 sm:py-14">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
            <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-7">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--savings-bg)] text-primary">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Local-Only Data Processing
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Your CSV is processed in your browser. Raw transactions are
                  not uploaded to our server. Saved audits stay on this device
                  until you delete them.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
