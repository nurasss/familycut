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
  Printer,
  RefreshCw,
} from "lucide-react";
import { fallbackAction } from "@/lib/ai/fallback";
import { buildSafeActionRequest } from "@/lib/ai/safe-request";
import { MULTIPLIER, annualCents, computeTotals } from "@/lib/engine/money";
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
import { TryDemoConfirmDialog } from "@/components/demo/try-demo-confirm-dialog";
import { useTryDemo } from "@/components/demo/use-try-demo";
import { useHasHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

const CLIENT_DEADLINE_MS = 8500;
const TONES: ActionTone[] = ["polite", "firm"];

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
  const isCut = expense.decision === "cut";
  const [tone, setTone] = useState<ActionTone>("polite");
  const [regenCount, setRegenCount] = useState(0);
  const [aiDraft, setAiDraft] = useState<{
    key: string;
    response: ActionResponse;
  } | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [reportedPriceDraft, setReportedPriceDraft] = useState(() =>
    expense.reportedNewPriceCents !== undefined
      ? centsToInputValue(expense.reportedNewPriceCents)
      : "",
  );
  const [reportedPriceError, setReportedPriceError] = useState<string | null>(
    null,
  );

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toneRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const statusRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const expenseId = expense.id;
  const rawSafeRequest = buildSafeActionRequest(expense, tone);
  const safeMerchant = rawSafeRequest.merchant;
  const safeAction = rawSafeRequest.action;
  const safeFrequency = rawSafeRequest.frequency;
  const safeCurrentPriceCents = rawSafeRequest.currentPriceCents;
  const safeTargetPriceCents = rawSafeRequest.targetPriceCents;
  const safeTone = rawSafeRequest.tone;

  const requestPayload = useMemo<ActionRequest>(() => {
    const req: ActionRequest = {
      merchant: safeMerchant,
      action: safeAction,
      frequency: safeFrequency,
      currentPriceCents: safeCurrentPriceCents,
      tone: safeTone,
    };
    if (safeTargetPriceCents !== undefined) {
      req.targetPriceCents = safeTargetPriceCents;
    }
    return req;
  }, [
    safeMerchant,
    safeAction,
    safeFrequency,
    safeCurrentPriceCents,
    safeTargetPriceCents,
    safeTone,
  ]);

  const requestKey = `${expenseId}|${safeAction}|${safeMerchant}|${safeFrequency}|${safeCurrentPriceCents}|${safeTargetPriceCents ?? "none"}|${safeTone}|${regenCount}`;
  const templateFallback = useMemo(
    () =>
      fallbackAction({
        ...requestPayload,
        merchant: expense.merchant,
      }),
    [requestPayload, expense.merchant],
  );

  const isEnhancing = settledKey !== requestKey;
  const hasAiDraftForFormat =
    aiDraft?.key === requestKey &&
    aiDraft.response.source === "ai" &&
    (isCut
      ? Boolean(aiDraft.response.body?.trim())
      : Boolean(aiDraft.response.callScript?.trim()));
  const actionData = hasAiDraftForFormat ? aiDraft.response : templateFallback;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, CLIENT_DEADLINE_MS);

    const run = async () => {
      try {
        const res = await fetch("/api/ai/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        const parsed = actionResponseSchema.safeParse(json);
        if (!parsed.success) throw new Error("Invalid response schema");
        if (
          active &&
          !controller.signal.aborted &&
          parsed.data.source === "ai"
        ) {
          setAiDraft({ key: requestKey, response: parsed.data });
        }
      } catch {
        // Keep immediate Template fallback on timeout, network, HTTP, or schema failure
      } finally {
        clearTimeout(timeoutId);
        if (active) {
          setSettledKey(requestKey);
        }
      }
    };

    void run();
    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [requestKey, requestPayload]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const displayedSubject = useMemo(() => {
    if (!isCut) return null;
    if (actionData.subject?.trim()) return actionData.subject;
    return templateFallback.subject ?? `Cancellation request: ${expense.merchant}`;
  }, [isCut, actionData.subject, templateFallback.subject, expense.merchant]);

  const displayedBody = useMemo(() => {
    if (isCut) {
      return actionData.body?.trim()
        ? actionData.body
        : (templateFallback.body ?? "");
    }
    return actionData.callScript?.trim()
      ? actionData.callScript
      : (templateFallback.callScript ?? "");
  }, [
    isCut,
    actionData.body,
    actionData.callScript,
    templateFallback.body,
    templateFallback.callScript,
  ]);

  const handleCopy = async () => {
    if (!displayedBody) return;
    const fullText =
      isCut && displayedSubject
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
      setReportedPriceError(null);
      setReportedPriceDraft("");
      onStatusChange(expense.id, status);
      return;
    }

    setReportedPriceError(null);
    if (expense.decision === "cut") {
      onStatusChange(expense.id, "completed", 0);
      return;
    }

    const trimmed = reportedPriceDraft.trim();
    const parsed = trimmed ? parsePriceInputToCents(trimmed) : null;
    if (parsed !== null) {
      onStatusChange(expense.id, "completed", parsed);
    } else {
      onStatusChange(expense.id, "completed");
    }
  };

  const handleReportedPriceChange = (raw: string) => {
    setReportedPriceDraft(raw);
    if (expense.actionStatus !== "completed" || expense.decision !== "negotiate") {
      return;
    }
    if (!raw.trim()) {
      setReportedPriceError(null);
      onStatusChange(expense.id, "completed", undefined);
      return;
    }
    const cents = parsePriceInputToCents(raw);
    if (cents === null) {
      setReportedPriceError("Enter a valid dollar price");
      onStatusChange(expense.id, "completed", undefined);
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

  const itemTotals = useMemo(() => computeTotals([expense]), [expense]);

  const handleToneKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % TONES.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + TONES.length) % TONES.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = TONES.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      setTone(TONES[nextIdx]);
      setCopied(false);
      toneRefs.current[nextIdx]?.focus();
    }
  };

  const handleStatusKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % STATUS_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + STATUS_OPTIONS.length) % STATUS_OPTIONS.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = STATUS_OPTIONS.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      handleStatusSelect(STATUS_OPTIONS[nextIdx].value);
      statusRefs.current[nextIdx]?.focus();
    }
  };

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
            {expense.frequency === "yearly" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Billed yearly: savings may start at your next renewal.
              </p>
            )}
          </div>

          <div
            role="radiogroup"
            aria-label="Message tone"
            className="inline-flex rounded-lg border border-border bg-background p-1"
          >
            {TONES.map((t, idx) => {
              const selected = tone === t;
              return (
                <button
                  key={t}
                  ref={(el) => {
                    toneRefs.current[idx] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    setTone(t);
                    setCopied(false);
                  }}
                  onKeyDown={(e) => handleToneKeyDown(e, idx)}
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
          <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground">
            {isCut ? (
              <>
                <Mail className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>Cancellation email</span>
              </>
            ) : (
              <>
                <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>Phone / chat script</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {hasAiDraftForFormat
                ? "Written by AI · review before sending"
                : "Template"}
            </span>
            {isEnhancing && !hasAiDraftForFormat && (
              <span className="text-xs text-muted-foreground">
                Refining draft…
              </span>
            )}
          </div>
        </div>

        <div
          data-testid="action-draft-panel"
          className="mt-4 rounded-xl border border-border bg-background/70 p-4 sm:p-5"
        >
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
        </div>

        <div className="no-print mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!displayedBody}
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
            disabled={isEnhancing}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4", isEnhancing && "animate-spin")}
              aria-hidden="true"
            />
            <span>Regenerate</span>
          </button>
        </div>
      </div>

      <div className="print-card-grid grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="print-avoid-break rounded-xl border border-border bg-card p-5">
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

        <div className="print-avoid-break rounded-xl border border-border bg-card p-5">
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

      <div className="print-avoid-break rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-bold text-foreground">Action status</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Track your own progress after contacting the provider.
        </p>

        <div
          role="radiogroup"
          aria-label="Action completion status"
          className="mt-3 flex flex-wrap gap-2"
        >
          {STATUS_OPTIONS.map((opt, idx) => {
            const active = expense.actionStatus === opt.value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  statusRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => handleStatusSelect(opt.value)}
                onKeyDown={(e) => handleStatusKeyDown(e, idx)}
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
            {expense.decision === "cut" ? (
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
                    readOnly
                    value="$0.00 (cancelled)"
                    className="min-h-11 w-40 rounded-lg border border-border bg-muted px-3 text-sm font-semibold text-foreground tabular-nums"
                  />
                </div>
                <p className="text-xs font-medium text-primary tabular-nums">
                  Reported {formatUsd(itemTotals.reportedAnnualCents)}/yr (not
                  bank-verified)
                </p>
              </div>
            ) : (
              <>
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
                      placeholder={`e.g. ${centsToInputValue(expense.targetPriceCents ?? expense.priceCents)}`}
                      aria-invalid={reportedPriceError ? "true" : undefined}
                      aria-describedby={
                        reportedPriceError
                          ? `${uid}-reported-price-error`
                          : undefined
                      }
                      className="min-h-11 w-32 rounded-lg border border-input bg-card px-3 text-sm font-semibold text-foreground tabular-nums placeholder:font-normal placeholder:text-muted-foreground/70"
                    />
                  </div>
                  {!reportedPriceError && (
                    <p
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        itemTotals.reportedAnnualCents <= 0
                          ? "text-muted-foreground"
                          : "text-primary",
                      )}
                    >
                      {!reportedPriceDraft.trim() ||
                      expense.reportedNewPriceCents === undefined
                        ? "Enter the new price to count self-reported savings"
                        : itemTotals.reportedAnnualCents <= 0
                          ? "No savings at this price"
                          : `Reported ${formatUsd(itemTotals.reportedAnnualCents)}/yr · Counts as self-reported savings (not bank-verified)`}
                    </p>
                  )}
                </div>
                {reportedPriceError && (
                  <p
                    id={`${uid}-reported-price-error`}
                    role="alert"
                    className="mt-1.5 text-xs text-[var(--chip-cut)]"
                  >
                    {reportedPriceError}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function ActionWorkspace({
  selectedIdFromRoute,
  hasExplicitRouteId = false,
  isRouteLoading = false,
}: {
  selectedIdFromRoute?: string;
  hasExplicitRouteId?: boolean;
  isRouteLoading?: boolean;
}) {
  const uid = useId();
  const router = useRouter();
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const { requestTryDemo, dialogProps: tryDemoDialogProps } = useTryDemo({
    redirectTo: "/action",
  });
  const setActionStatus = useAuditStore((s) => s.setActionStatus);

  const actionExpenses = useMemo(
    () =>
      (session?.expenses ?? []).filter(
        (e) => e.decision === "cut" || e.decision === "negotiate",
      ),
    [session],
  );

  const hasRouteId = hasExplicitRouteId || selectedIdFromRoute !== undefined;
  const normalizedRouteId = (selectedIdFromRoute ?? "").trim();

  const activeExpense = useMemo(() => {
    if (actionExpenses.length === 0) return null;
    if (hasRouteId) {
      if (!normalizedRouteId) return null;
      return actionExpenses.find((e) => e.id === normalizedRouteId) ?? null;
    }
    return actionExpenses[0];
  }, [actionExpenses, hasRouteId, normalizedRouteId]);

  const isMissingRequestedExpense =
    hydrated && !isRouteLoading && hasRouteId && !activeExpense;

  const handleSelectExpense = (id: string) => {
    router.replace(`/action?id=${encodeURIComponent(id)}`, { scroll: false });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="app" currentStep={3} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {!hydrated || isRouteLoading ? (
          <div
            className="space-y-4"
            aria-busy="true"
            aria-label="Loading action plan"
          >
            <div className="h-9 w-60 animate-pulse rounded-lg bg-muted" />
            <div className="h-72 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : isMissingRequestedExpense ? (
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Action plan unavailable
            </p>
            <h1 className="mt-2 text-2xl font-extrabold text-foreground">
              Expense not found
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This link points to an expense that does not exist, was removed,
              or is not marked as Cut or Negotiate.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/results"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Back to Review
              </Link>
              <Link
                href="/audit"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Import or edit expenses
              </Link>
            </div>
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
                onClick={requestTryDemo}
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
                  Copy your message, contact the provider yourself, and update
                  your progress below. Only the selected bill&apos;s summary
                  fields (merchant, action, frequency, price, optional target,
                  and tone) are sent to request an AI draft; local templates
                  work immediately.
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
                  href="/results"
                  className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Back to Review
                </Link>
              </div>
            </div>

            <div className="no-print lg:hidden">
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

            <div className="print-single-col grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <aside
                aria-label="Selected actions list"
                className="no-print hidden lg:col-span-4 lg:block"
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

      <TryDemoConfirmDialog {...tryDemoDialogProps} />

      <SiteFooter />
    </div>
  );
}
