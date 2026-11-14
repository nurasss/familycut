"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useAuditStore } from "@/lib/store";
import type { Expense } from "@/lib/types";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ManualTab } from "@/components/audit/manual-tab";
import { ImportTab } from "@/components/audit/import-tab";
import { useHasHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

type AuditTabId = "manual" | "paste" | "csv";

const TABS: { id: AuditTabId; label: string }[] = [
  { id: "manual", label: "Add manually" },
  { id: "paste", label: "Paste transactions" },
  { id: "csv", label: "Upload CSV" },
];

export default function AuditPage() {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const session = useAuditStore((s) => s.session);
  const isDemo = useAuditStore((s) => s.isDemo);
  const startSession = useAuditStore((s) => s.startSession);
  const loadDemo = useAuditStore((s) => s.loadDemo);

  const [activeTab, setActiveTab] = useState<AuditTabId>("manual");
  const [pasteExpenses, setPasteExpenses] = useState<Expense[]>([]);
  const [csvExpenses, setCsvExpenses] = useState<Expense[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const resetLocalAuditState = () => {
      setPasteExpenses([]);
      setCsvExpenses([]);
      setAnalyzeError(null);
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
  }, []);
  const tabRefs = useRef<Record<AuditTabId, HTMLButtonElement | null>>({
    manual: null,
    paste: null,
    csv: null,
  });

  const handlePasteExpenses = useCallback((expenses: Expense[]) => {
    setPasteExpenses(expenses);
    setAnalyzeError(null);
  }, []);

  const handleCsvExpenses = useCallback((expenses: Expense[]) => {
    setCsvExpenses(expenses);
    setAnalyzeError(null);
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
      tabRefs.current[target.id]?.focus();
    }
  };

  const manualCount = hydrated && session && !isDemo ? session.expenses.length : 0;

  const readyCount =
    activeTab === "manual"
      ? manualCount
      : activeTab === "paste"
        ? pasteExpenses.length
        : csvExpenses.length;

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

    const expenses = activeTab === "paste" ? pasteExpenses : csvExpenses;
    if (expenses.length === 0) {
      setAnalyzeError(
        activeTab === "paste"
          ? "Preview pasted transactions with at least one recurring expense first."
          : "Upload and preview a CSV with at least one recurring expense first.",
      );
      return;
    }

    startSession(expenses, { isDemo: false });
    router.push("/results");
  };

  const handleTryDemo = () => {
    loadDemo();
    router.push("/results");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader variant="app" currentStep={1} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 sm:px-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Add your recurring expenses
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            Use any method. Nothing is uploaded — it&apos;s processed in your
            browser.
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
              onExpensesChange={handlePasteExpenses}
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
              onExpensesChange={handleCsvExpenses}
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
      <div className="sticky bottom-0 z-20 border-t border-border bg-card shadow-[0_-4px_16px_rgba(28,25,23,0.06)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={handleTryDemo}
            className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold text-primary underline-offset-4 hover:underline sm:px-3 sm:text-sm"
          >
            Try demo data
          </button>

          <button
            type="button"
            onClick={handleAnalyze}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-95 sm:gap-2 sm:px-5 sm:text-sm"
          >
            <span>
              Analyze expenses{readyCount > 0 ? ` (${readyCount})` : ""}
            </span>
            <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
