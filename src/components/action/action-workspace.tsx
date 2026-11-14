"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Mail,
  Phone,
  RefreshCw,
} from "lucide-react";
import { fallbackAction } from "@/lib/ai/fallback";
import { MULTIPLIER, annualCents } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import { actionResponseSchema } from "@/lib/schemas";
import { useAuditStore } from "@/lib/store";
import type {
  ActionRequest,
  ActionResponse,
  ActionStatus,
  ActionTone,
  Expense,
} from "@/lib/types";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import {
  ActionStatusBadge,
  DecisionChip,
  SampleDataBadge,
} from "@/components/ui-badges";
import {
  FREQUENCY_SHORT,
  centsToInputValue,
  parsePriceInputToCents,
} from "@/components/money-input";
import { useHasHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

type ChannelTab = "email" | "script";

const STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "attempted", label: "Attempted" },
  { value: "completed", label: "Completed" },
];

function renderWithPlaceholders(text: string) {
  const parts = text.split(/(\[[^\]\n]+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith("[") && part.endsWith("]")) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-block rounded-md border border-amber-300 bg-[var(--chip-negotiate-bg)] px-1.5 py-0.5 text-xs font-semibold text-[var(--chip-negotiate)]"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function buildStrictRequest(
  expense: Expense,
  tone: ActionTone,
): ActionRequest {
  const action = expense.decision === "cut" ? "cut" : "negotiate";
  const req: ActionRequest = {
    merchant: expense.merchant.slice(0, 80),
    action,
    frequency: expense.frequency,
    currentPriceCents: expense.priceCents,
    tone,
  };
  if (expense.targetPriceCents !== undefined) {
    req.targetPriceCents = expense.targetPriceCents;
  }
  return req;
}

function ActionDetail({
  expense,
  onStatusChange,
}: {
  expense: Expense;
  onStatusChange: (
    id: string,
    status: ActionStatus,
    reportedNewPriceCents?: number,
  ) => void;
}) {
  const uid = useId();
  const [tone, setTone] = useState<ActionTone>("polite");
  const [channel, setChannel] = useState<ChannelTab>(
    expense.decision === "cut" ? "email" : "script",
  );
  const [regenCount, setRegenCount] = useState(0);
  const [draft, setDraft] = useState<{
    key: string;
    response: ActionResponse;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [reportedPriceDraft, setReportedPriceDraft] = useState(() => {
    const initialCents =
      expense.actionStatus === "completed"
        ? (expense.reportedNewPriceCents ??
          (expense.decision === "cut"
            ? 0
            : (expense.targetPriceCents ?? expense.priceCents)))
        : expense.decision === "cut"
          ? 0
          : (expense.targetPriceCents ?? expense.priceCents);
    return centsToInputValue(initialCents);
  });
  const [reportedPriceError, setReportedPriceError] = useState<string | null>(
    null,
  );

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestKey = `${expense.id}|${expense.decision}|${expense.merchant}|${expense.frequency}|${expense.priceCents}|${expense.targetPriceCents ?? "none"}|${tone}|${regenCount}`;
  const loading = draft === null || draft.key !== requestKey;
  const actionData = draft?.key === requestKey ? draft.response : null;

  useEffect(() => {
    const controller = new AbortController();
    const payload = buildStrictRequest(expense, tone);

    const run = async () => {
      try {
        const res = await fetch("/api/ai/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        const parsed = actionResponseSchema.safeParse(json);
        if (!parsed.success) throw new Error("Invalid response schema");
        if (!controller.signal.aborted) {
          setDraft({ key: requestKey, response: parsed.data });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setDraft({ key: requestKey, response: fallbackAction(payload) });
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [requestKey, expense, tone]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const displayedSubject = useMemo(() => {
    if (!actionData || channel !== "email") return null;
    if (actionData.subject) return actionData.subject;
    return expense.decision === "cut"
      ? `Cancellation request: ${expense.merchant}`
      : `Billing review request: ${expense.merchant}`;
  }, [expense.decision, expense.merchant, actionData, channel]);

  const displayedBody = useMemo(() => {
    if (!actionData) return "";
    if (channel === "email") {
      return actionData.body ?? actionData.callScript ?? "";
    }
    return actionData.callScript ?? actionData.body ?? "";
  }, [actionData, channel]);

  const handleCopy = async () => {
    if (!displayedBody) return;
    const fullText = displayedSubject
      ? `Subject: ${displayedSubject}\n\n${displayedBody}`
      : displayedBody;

    try {
      await navigator.clipboard.writeText(fullText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fullText;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2500);
  };

  const handleStatusSelect = (status: ActionStatus) => {
    if (status !== "completed") {
      onStatusChange(expense.id, status);
      return;
    }

    const defaultCents =
      expense.decision === "cut"
        ? 0
        : (expense.targetPriceCents ?? expense.priceCents);
    const parsed = parsePriceInputToCents(reportedPriceDraft);
    const cents = parsed !== null ? parsed : defaultCents;
    setReportedPriceDraft(centsToInputValue(cents));
    setReportedPriceError(null);
    onStatusChange(expense.id, "completed", cents);
  };

  const handleReportedPriceChange = (raw: string) => {
    setReportedPriceDraft(raw);
    if (expense.actionStatus !== "completed") return;
    const cents = parsePriceInputToCents(raw);
    if (cents === null) {
      setReportedPriceError("Enter a valid dollar price");
      return;
    }
    setReportedPriceError(null);
    onStatusChange(expense.id, "completed", cents);
  };

  const freqShort = FREQUENCY_SHORT[expense.frequency];

  const summaryText = useMemo(() => {
    const current = `${formatUsd(expense.priceCents)}/${freqShort}`;
    if (expense.decision === "cut") {
      const potential = annualCents(expense.priceCents, expense.frequency);
      return `You pay ${current} · Target $0.00/${freqShort} · Potential ${formatUsd(potential)}/yr (estimate)`;
    }
    if (expense.targetPriceCents !== undefined) {
      const potential =
        Math.max(0, expense.priceCents - expense.targetPriceCents) *
        MULTIPLIER[expense.frequency];
      return `You pay ${current} · Target ${formatUsd(expense.targetPriceCents)}/${freqShort} · Potential ${formatUsd(potential)}/yr (estimate)`;
    }
    return `You pay ${current} · No target price set (add one on Review to estimate savings)`;
  }, [expense, freqShort]);

  const limitationsList = useMemo(() => {
    const core =
      "You must contact the provider yourself. FamilyCut does not cancel or negotiate on your behalf.";
    const extras = (actionData?.limitations ?? []).filter(
      (l) => !l.toLowerCase().includes("contact the provider yourself"),
    );
    return [core, ...extras];
  }, [actionData]);

  return (
    <section
      aria-label={`Action details for ${expense.merchant}`}
      className="space-y-5 lg:col-span-8"
    >
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-extrabold text-foreground">
                {expense.merchant}
              </h2>
              <DecisionChip decision={expense.decision} />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
              {summaryText}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="Message tone"
            className="inline-flex rounded-lg border border-border bg-background p-1"
          >
            {(["polite", "firm"] as const).map((t) => {
              const selected = tone === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setTone(t);
                    setCopied(false);
                  }}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-md px-3 text-xs font-semibold capitalize transition-colors",
                    selected
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Message format"
            className="inline-flex rounded-lg border border-border bg-background p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={channel === "email"}
              onClick={() => {
                setChannel("email");
                setCopied(false);
              }}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-colors",
                channel === "email"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Mail className="size-3.5" aria-hidden="true" />
              <span>Email</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={channel === "script"}
              onClick={() => {
                setChannel("script");
                setCopied(false);
              }}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-colors",
                channel === "script"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Phone className="size-3.5" aria-hidden="true" />
              <span>Phone / chat script</span>
            </button>
          </div>

          {!loading && actionData && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {actionData.source === "ai"
                ? "Written by AI · review before sending"
                : "Template"}
            </span>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-background/70 p-4 sm:p-5">
          {loading ? (
            <div
              className="space-y-3"
              aria-busy="true"
              aria-label="Preparing message draft"
            >
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-3">
              {displayedSubject && (
                <div className="border-b border-border pb-2.5 text-sm">
                  <span className="font-semibold text-muted-foreground">
                    Subject:{" "}
                  </span>
                  <span className="font-semibold text-foreground">
                    {renderWithPlaceholders(displayedSubject)}
                  </span>
                </div>
              )}
              <div className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                {renderWithPlaceholders(displayedBody)}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={loading || !displayedBody}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50 sm:flex-initial"
          >
            {copied ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                <span>Copied ✓</span>
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setCopied(false);
              setRegenCount((c) => c + 1);
            }}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4", loading && "animate-spin")}
              aria-hidden="true"
            />
            <span>Regenerate</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold text-foreground">
            Next steps checklist
          </h3>
          <ul className="mt-3 space-y-2">
            {(actionData?.steps ?? []).map((step, i) => {
              const stepKey = `${expense.id}-${i}`;
              const checked = Boolean(checkedSteps[stepKey]);
              return (
                <li key={stepKey}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg p-1.5 text-sm text-foreground hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setCheckedSteps((prev) => ({
                          ...prev,
                          [stepKey]: e.target.checked,
                        }))
                      }
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span
                      className={cn(
                        "leading-snug",
                        checked && "text-muted-foreground line-through",
                      )}
                    >
                      {step}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-4 text-[var(--chip-negotiate)]"
              aria-hidden="true"
            />
            <h3 className="text-sm font-bold text-foreground">
              Important limitations
            </h3>
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            {limitationsList.map((lim, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{lim}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold text-foreground">Action status</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Track your own progress after contacting the provider.
        </p>

        <div
          role="radiogroup"
          aria-label="Action completion status"
          className="mt-3 flex flex-wrap gap-2"
        >
          {STATUS_OPTIONS.map((opt) => {
            const active = expense.actionStatus === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleStatusSelect(opt.value)}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground font-semibold"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {expense.actionStatus === "completed" && (
          <div className="mt-4 rounded-lg border border-[#BBF7D0] bg-[var(--savings-bg)]/50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2.5">
                <label
                  htmlFor={`${uid}-reported-price`}
                  className="text-sm font-semibold text-foreground"
                >
                  New price you got ($ / {freqShort})
                </label>
                <input
                  id={`${uid}-reported-price`}
                  type="text"
                  inputMode="decimal"
                  value={reportedPriceDraft}
                  onChange={(e) => handleReportedPriceChange(e.target.value)}
                  aria-invalid={reportedPriceError ? "true" : undefined}
                  className="min-h-11 w-28 rounded-lg border border-input bg-card px-3 text-sm font-semibold text-foreground tabular-nums"
                />
              </div>
              <p className="text-xs font-medium text-primary">
                Counts as self-reported savings (not bank-verified)
              </p>
            </div>
            {reportedPriceError && (
              <p role="alert" className="mt-1.5 text-xs text-[var(--chip-cut)]">
                {reportedPriceError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function ActionWorkspace({
  selectedIdFromRoute,
}: {
  selectedIdFromRoute?: string;
}) {
  const uid = useId();
  const router = useRouter();
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const loadDemo = useAuditStore((s) => s.loadDemo);
  const setActionStatus = useAuditStore((s) => s.setActionStatus);

  const actionExpenses = useMemo(
    () =>
      (session?.expenses ?? []).filter(
        (e) => e.decision === "cut" || e.decision === "negotiate",
      ),
    [session],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeExpense = useMemo(() => {
    if (actionExpenses.length === 0) return null;
    const preferredId = selectedId ?? selectedIdFromRoute;
    if (preferredId) {
      const found = actionExpenses.find((e) => e.id === preferredId);
      if (found) return found;
    }
    return actionExpenses[0];
  }, [actionExpenses, selectedId, selectedIdFromRoute]);

  const handleSelectExpense = (id: string) => {
    setSelectedId(id);
    router.replace(`/action?id=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="app" currentStep={3} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {!hydrated ? (
          <div
            className="space-y-4"
            aria-busy="true"
            aria-label="Loading action plan"
          >
            <div className="h-9 w-60 animate-pulse rounded-lg bg-muted" />
            <div className="h-72 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : actionExpenses.length === 0 || !activeExpense ? (
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="text-2xl font-extrabold text-foreground">
              No actions selected yet
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Mark at least one recurring expense as Cut or Negotiate on the
              Review step to generate cancellation emails or negotiation scripts.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/results"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Back to Review
              </Link>
              <button
                type="button"
                onClick={() => {
                  loadDemo();
                  router.push("/action");
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Try demo
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                    Action plan
                  </h1>
                  {isDemo && <SampleDataBadge />}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Copy your personalized message, reach out to the provider, and
                  update your progress below.
                </p>
              </div>

              <Link
                href="/results"
                className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
              >
                Back to Review
              </Link>
            </div>

            <div className="lg:hidden">
              <label
                htmlFor={`${uid}-mobile-select`}
                className="block text-xs font-semibold text-muted-foreground"
              >
                Selected action ({actionExpenses.length})
              </label>
              <select
                id={`${uid}-mobile-select`}
                value={activeExpense.id}
                onChange={(e) => handleSelectExpense(e.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm font-semibold text-foreground"
              >
                {actionExpenses.map((exp) => (
                  <option key={exp.id} value={exp.id}>
                    {exp.merchant} ({exp.decision === "cut" ? "Cut" : "Negotiate"}
                    ) —{" "}
                    {exp.actionStatus === "completed"
                      ? "Completed"
                      : exp.actionStatus === "attempted"
                        ? "Attempted"
                        : "Not started"}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <aside
                aria-label="Selected actions list"
                className="hidden lg:col-span-4 lg:block"
              >
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Your action queue ({actionExpenses.length})
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {actionExpenses.map((exp) => {
                      const active = exp.id === activeExpense.id;
                      return (
                        <li key={exp.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectExpense(exp.id)}
                            aria-current={active ? "true" : undefined}
                            className={cn(
                              "flex min-h-11 w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                              active
                                ? "border-primary bg-background font-semibold"
                                : "border-transparent bg-card hover:bg-muted/60",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold text-foreground">
                                {exp.merchant}
                              </span>
                              <DecisionChip decision={exp.decision} />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {formatUsd(exp.priceCents)}/
                                {FREQUENCY_SHORT[exp.frequency]}
                              </span>
                              <ActionStatusBadge status={exp.actionStatus} />
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </aside>

              <ActionDetail
                key={activeExpense.id}
                expense={activeExpense}
                onStatusChange={setActionStatus}
              />
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
