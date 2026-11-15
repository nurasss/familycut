"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useAuditStore } from "@/lib/store";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ManualTab } from "@/components/audit/manual-tab";
import {
  ImportTab,
  type ImportTabState,
} from "@/components/audit/import-tab";
import { ReplaceAuditDialog } from "@/components/audit/replace-audit-dialog";
import { TryDemoConfirmDialog } from "@/components/demo/try-demo-confirm-dialog";
import { useTryDemo } from "@/components/demo/use-try-demo";
import { useHasHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

type AuditTabId = "manual" | "paste" | "csv";

const INITIAL_IMPORT_STATE: ImportTabState = {
  expenses: [],
  isSample: false,
  isLoading: false,
  error: null,
  isReady: false,
  blockedReason: null,
  pendingConfirmationCount: 0,
  rejectedGroupCount: 0,
};

const TABS: { id: AuditTabId; label: string }[] = [
  { id: "manual", label: "Add manually" },
  { id: "paste", label: "Paste transactions" },
  { id: "csv", label: "Upload CSV" },
];

export default function AuditPage() {
  const router = useRouter();
  const analyzeHelpId = useId();
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const startSession = useAuditStore((s) => s.startSession);
  const {
    requestTryDemo,
    cancelTryDemo,
    dialogProps: tryDemoDialogProps,
  } = useTryDemo({ redirectTo: "/results" });

  const [activeTab, setActiveTab] = useState<AuditTabId>("manual");
  const [pasteState, setPasteState] =
    useState<ImportTabState>(INITIAL_IMPORT_STATE);
  const [csvState, setCsvState] =
    useState<ImportTabState>(INITIAL_IMPORT_STATE);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const resetLocalAuditState = () => {
      setPasteState(INITIAL_IMPORT_STATE);
      setCsvState(INITIAL_IMPORT_STATE);
      setAnalyzeError(null);
      setReplaceDialogOpen(false);
      cancelTryDemo();
      setActiveTab("manual");
      setResetKey((k) => k + 1);
    };

    const handleResetEvent = () => {
      resetLocalAuditState();
    };

    window.addEventListener("familycut:delete-all-data", handleResetEvent);
    const unsub = useAuditStore.subscribe((state, prevState) => {
      if (prevState.session !== null && state.session === null && !state.isDemo) {
        resetLocalAuditState();
      }
    });

    return () => {
      window.removeEventListener("familycut:delete-all-data", handleResetEvent);
      unsub();
    };
  }, [cancelTryDemo]);
  const tabRefs = useRef<Record<AuditTabId, HTMLButtonElement | null>>({
    manual: null,
    paste: null,
    csv: null,
  });

  const handlePasteState = useCallback((next: ImportTabState) => {
    setPasteState(next);
    setAnalyzeError(null);
    if (
      !next.isReady ||
      next.pendingConfirmationCount > 0 ||
      next.rejectedGroupCount > 0 ||
      next.expenses.length === 0
    ) {
      setReplaceDialogOpen(false);
    }
  }, []);

  const handleCsvState = useCallback((next: ImportTabState) => {
    setCsvState(next);
    setAnalyzeError(null);
    if (
      !next.isReady ||
      next.pendingConfirmationCount > 0 ||
      next.rejectedGroupCount > 0 ||
      next.expenses.length === 0
    ) {
      setReplaceDialogOpen(false);
    }
  }, []);

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft")
      nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = TABS.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      const target = TABS[nextIdx];
      setActiveTab(target.id);
      setAnalyzeError(null);
      setReplaceDialogOpen(false);
      tabRefs.current[target.id]?.focus();
    }
  };

  const manualCount = hydrated && session && !isDemo ? session.expenses.length : 0;
  const currentImportState = activeTab === "paste" ? pasteState : csvState;

  const hasRealNonEmptySession =
    hydrated &&
    session !== null &&
    !isDemo &&
    (session.expenses.length > 0 || session.goal !== undefined);

  const hasGoal = Boolean(session?.goal);
  const hasReportedSavings = Boolean(
    session?.expenses.some(
      (exp) =>
        exp.reportedNewPriceCents !== undefined ||
        exp.completedAt !== undefined ||
        exp.actionStatus === "completed",
    ),
  );

  const isImportBlocked =
    activeTab !== "manual" && Boolean(currentImportState.blockedReason);

  const canAnalyze =
    activeTab === "manual"
      ? manualCount > 0
      : currentImportState.isReady &&
        !currentImportState.isLoading &&
        !currentImportState.error &&
        !currentImportState.blockedReason &&
        currentImportState.pendingConfirmationCount === 0 &&
        currentImportState.rejectedGroupCount === 0 &&
        currentImportState.expenses.length > 0;

  const readyCount =
    activeTab === "manual"
      ? manualCount
      : canAnalyze
        ? currentImportState.expenses.length
        : 0;

  const isReplaceDialogOpen =
    replaceDialogOpen &&
    activeTab !== "manual" &&
    canAnalyze &&
    hasRealNonEmptySession;

  const handleAnalyze = () => {
    setAnalyzeError(null);
    if (activeTab === "manual") {
      if (!session || isDemo || session.expenses.length === 0) {
        setAnalyzeError(
          "Add at least one expense manually, or choose Try demo data.",
        );
        return;
      }
      router.push("/results");
      return;
    }

    const current = activeTab === "paste" ? pasteState : csvState;
    if (
      !current.isReady ||
      current.isLoading ||
      current.error ||
      current.blockedReason ||
      current.pendingConfirmationCount > 0 ||
      current.rejectedGroupCount > 0 ||
      current.expenses.length === 0
    ) {
      setAnalyzeError(
        current.blockedReason ??
          (activeTab === "paste"
            ? "Preview pasted transactions with at least one recurring expense first."
            : "Upload and preview a CSV with at least one recurring expense first."),
      );
      return;
    }

    if (hasRealNonEmptySession) {
      setReplaceDialogOpen(true);
      return;
    }

    startSession(current.expenses, { isDemo: current.isSample });
    router.push("/results");
  };

  const handleConfirmReplace = () => {
    if (activeTab === "manual") {
      setReplaceDialogOpen(false);
      return;
    }
    const current = activeTab === "paste" ? pasteState : csvState;
    if (
      !current.isReady ||
      current.isLoading ||
      current.error ||
      current.blockedReason ||
      current.pendingConfirmationCount > 0 ||
      current.rejectedGroupCount > 0 ||
      current.expenses.length === 0
    ) {
      setReplaceDialogOpen(false);
      setAnalyzeError(
        current.blockedReason ??
          "Resolve preview or grouping issues before analyzing.",
      );
      return;
    }
    setReplaceDialogOpen(false);
    startSession(current.expenses, { isDemo: current.isSample });
    router.push("/results");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="app" currentStep={1} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Add your recurring expenses
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            Use any method. Your CSV and pasted rows are parsed locally in your
            browser; raw transactions are not uploaded. Only one bill&apos;s
            summary fields are sent when generating an AI script.
          </p>
        </div>

        {/* Accessible 3-tab selector */}
        <div
          role="tablist"
          aria-label="Expense input method"
          className="mt-6 flex overflow-x-auto border-b border-border"
        >
          {TABS.map((tab, idx) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setActiveTab(tab.id);
                  setAnalyzeError(null);
                  setReplaceDialogOpen(false);
                }}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={cn(
                  "relative flex flex-1 items-center justify-center min-h-11 px-2 py-2.5 text-xs font-medium transition-colors whitespace-nowrap sm:flex-initial sm:px-4 sm:text-sm",
                  selected
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          <div
            role="tabpanel"
            aria-labelledby="tab-manual"
            hidden={activeTab !== "manual"}
          >
            {activeTab === "manual" && <ManualTab key={`manual-${resetKey}`} />}
          </div>
          <div
            role="tabpanel"
            aria-labelledby="tab-paste"
            hidden={activeTab !== "paste"}
          >
            <ImportTab
              key={`paste-${resetKey}`}
              mode="paste"
              onStateChange={handlePasteState}
            />
          </div>
          <div
            role="tabpanel"
            aria-labelledby="tab-csv"
            hidden={activeTab !== "csv"}
          >
            <ImportTab
              key={`csv-${resetKey}`}
              mode="csv"
              onStateChange={handleCsvState}
            />
          </div>
        </div>

        {analyzeError && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-[var(--chip-cut-bg)]/60 px-4 py-3 text-sm font-medium text-[var(--chip-cut)]"
          >
            {analyzeError}
          </p>
        )}
      </main>

      {/* Bottom sticky action bar */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(28,25,23,0.06)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={requestTryDemo}
            className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold text-primary underline-offset-4 hover:underline sm:px-3 sm:text-sm"
          >
            Try demo data
          </button>

          <button
            type="button"
            disabled={!canAnalyze}
            aria-describedby={isImportBlocked ? analyzeHelpId : undefined}
            onClick={handleAnalyze}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 sm:gap-2 sm:px-5 sm:text-sm"
          >
            <span>
              Analyze expenses{readyCount > 0 ? ` (${readyCount})` : ""}
            </span>
            <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          </button>
          {isImportBlocked ? (
            <span id={analyzeHelpId} className="sr-only">
              {currentImportState.blockedReason}
            </span>
          ) : null}
        </div>
      </div>

      <ReplaceAuditDialog
        open={isReplaceDialogOpen}
        existingExpenseCount={session?.expenses.length ?? 0}
        hasGoal={hasGoal}
        hasReportedSavings={hasReportedSavings}
        nextExpenseCount={currentImportState.expenses.length}
        nextIsSample={currentImportState.isSample}
        onCancel={() => setReplaceDialogOpen(false)}
        onConfirmReplace={handleConfirmReplace}
      />

      <TryDemoConfirmDialog {...tryDemoDialogProps} />

      <SiteFooter />
    </div>
  );
}
