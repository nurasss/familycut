"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, FileSpreadsheet, Info, RefreshCw, Upload, X } from "lucide-react";
import {
  applyGroupOp,
  type GroupAssignment,
  type GroupOp,
  type GroupProposal,
} from "@/lib/engine/grouping";
import { DEMO_TRANSACTIONS_CSV } from "@/lib/fixtures/miller";
import type { ColumnMapping, Expense, RawRow } from "@/lib/types";
import { GroupConfirmDialog } from "@/components/audit/group-confirm-dialog";
import { GroupingPanel } from "@/components/audit/grouping-panel";
import {
  MAX_FILE_BYTES,
  evaluateMappedRows,
  parseInputRows,
} from "@/components/audit/import-adapter";
import { PreviewRows } from "@/components/audit/preview-rows";
import { cn } from "@/lib/utils";

export type ImportTabState = {
  expenses: Expense[];
  isSample: boolean;
  isLoading: boolean;
  error: string | null;
  isReady: boolean;
  blockedReason: string | null;
  pendingConfirmationCount: number;
  rejectedGroupCount: number;
};

type ImportTabProps = {
  mode: "paste" | "csv";
  onStateChange?: (state: ImportTabState) => void;
  onExpensesChange?: (expenses: Expense[]) => void;
};

const LOADING_STEPS = [
  "Parsing rows locally in your browser…",
  "Normalizing merchant names…",
  "Checking recurring charge intervals…",
];

export function ImportTab({
  mode,
  onStateChange,
  onExpensesChange,
}: ImportTabProps) {
  const uid = useId();
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RawRow>>({});
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());

  const [assignments, setAssignments] = useState<GroupAssignment[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupingError, setGroupingError] = useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);

  const jobIdRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
  }, []);

  const cancelCurrentJob = useCallback(() => {
    jobIdRef.current += 1;
    clearTimers();
  }, [clearTimers]);

  const clearGroupingState = useCallback(() => {
    setAssignments([]);
    setSelectedIndices([]);
    setGroupNameInput("");
    setGroupingError(null);
    setMappingNotice(null);
    setConfirmGroupId(null);
  }, []);

  const clearPreviewState = useCallback(() => {
    setRawRows([]);
    setHeaders([]);
    setMapping(null);
    setOverrides({});
    setSkippedIndices(new Set());
    clearGroupingState();
  }, [clearGroupingState]);

  useEffect(() => {
    mountedRef.current = true;
    const handleDeleteAll = () => {
      cancelCurrentJob();
      setPasteText("");
      setFileName(null);
      setRawText(null);
      setIsSample(false);
      clearPreviewState();
      setIsLoading(false);
      setLoadingStepIdx(0);
      setParseError(null);
    };

    window.addEventListener("familycut:delete-all-data", handleDeleteAll);
    return () => {
      mountedRef.current = false;
      cancelCurrentJob();
      window.removeEventListener("familycut:delete-all-data", handleDeleteAll);
    };
  }, [cancelCurrentJob, clearPreviewState]);

  const runParse = (
    text: string,
    opts?: { jobId?: number; sample?: boolean },
  ) => {
    clearTimers();
    const jobId = opts?.jobId ?? ++jobIdRef.current;

    setParseError(null);
    clearPreviewState();
    if (opts?.sample !== undefined) {
      setIsSample(opts.sample);
    }

    if (!text.trim()) {
      setIsLoading(false);
      setRawText(null);
      setIsSample(false);
      if (mode === "paste") {
        setParseError("Paste at least one transaction line to preview.");
      } else {
        setParseError("This CSV file appears to be empty.");
      }
      return;
    }

    setIsLoading(true);
    setLoadingStepIdx(0);

    // Brief async yield so loading steps render visibly and UI stays responsive
    const timer1 = setTimeout(() => {
      if (!mountedRef.current || jobIdRef.current !== jobId) return;
      setLoadingStepIdx(1);
    }, 80);
    const timer2 = setTimeout(() => {
      if (!mountedRef.current || jobIdRef.current !== jobId) return;
      setLoadingStepIdx(2);
    }, 160);
    const timer3 = setTimeout(() => {
      clearTimers();
      if (!mountedRef.current || jobIdRef.current !== jobId) return;

      const parsed = parseInputRows(mode, text);
      setIsLoading(false);

      if (!parsed.ok) {
        clearPreviewState();
        setParseError(parsed.error);
        return;
      }

      if (parsed.rows.length === 0) {
        clearPreviewState();
        setParseError("No transaction rows found. Check the format and try again.");
        return;
      }

      setRawRows(parsed.rows);
      setHeaders(parsed.headers);
      setMapping(parsed.mapping);
    }, 240);

    timersRef.current = [timer1, timer2, timer3];
  };

  const evaluated = useMemo(() => {
    if (rawRows.length === 0 || !mapping) return null;
    return evaluateMappedRows(
      rawRows,
      mapping,
      overrides,
      skippedIndices,
      assignments,
    );
  }, [rawRows, mapping, overrides, skippedIndices, assignments]);

  const activeError =
    parseError ?? (evaluated && !evaluated.ok ? evaluated.error : null);

  const hasUnpreviewedPaste =
    mode === "paste" && (rawText === null || pasteText !== rawText);

  const pendingConfirmationCount =
    evaluated && evaluated.ok
      ? evaluated.groupReports.filter((r) => r.status === "needs_confirmation")
          .length
      : 0;
  const rejectedGroupCount =
    evaluated && evaluated.ok
      ? evaluated.groupReports.filter((r) => r.status === "rejected").length
      : 0;

  let blockedReason: string | null = null;
  if (pendingConfirmationCount > 0 && rejectedGroupCount > 0) {
    blockedReason = `Resolve ${pendingConfirmationCount} pending confirmation${pendingConfirmationCount === 1 ? "" : "s"} and undo ${rejectedGroupCount} rejected group${rejectedGroupCount === 1 ? "" : "s"} before analyzing.`;
  } else if (pendingConfirmationCount > 0) {
    blockedReason = `Confirm or undo ${pendingConfirmationCount} pending merge${pendingConfirmationCount === 1 ? "" : "s"} before analyzing.`;
  } else if (rejectedGroupCount > 0) {
    blockedReason = `Undo ${rejectedGroupCount} rejected group${rejectedGroupCount === 1 ? "" : "s"} before analyzing.`;
  }

  const isReady =
    !isLoading &&
    !activeError &&
    !hasUnpreviewedPaste &&
    evaluated !== null &&
    evaluated.ok &&
    pendingConfirmationCount === 0 &&
    rejectedGroupCount === 0 &&
    evaluated.expenses.length > 0;

  const activeSelectedIndices = useMemo(() => {
    if (!evaluated || !evaluated.ok) return [];
    const selectableSet = new Set(
      evaluated.previews
        .filter((p) => p.status === "valid" && (p.transaction?.amountCents ?? 0) > 0)
        .map((p) => p.rawIndex),
    );
    return selectedIndices.filter((idx) => selectableSet.has(idx));
  }, [evaluated, selectedIndices]);

  const effectiveConfirmGroupId = useMemo(() => {
    if (confirmGroupId === null || !evaluated || !evaluated.ok) return null;
    const isPending = evaluated.groupReports.some(
      (r) => r.groupId === confirmGroupId && r.status === "needs_confirmation",
    );
    return isPending ? confirmGroupId : null;
  }, [confirmGroupId, evaluated]);

  useEffect(() => {
    const readyExpenses =
      isReady && evaluated && evaluated.ok ? evaluated.expenses : [];
    const nextState: ImportTabState = {
      expenses: readyExpenses,
      isSample: isReady ? isSample : false,
      isLoading,
      error: activeError,
      isReady,
      blockedReason: !isLoading && !activeError ? blockedReason : null,
      pendingConfirmationCount,
      rejectedGroupCount,
    };
    onStateChange?.(nextState);
    onExpensesChange?.(readyExpenses);
  }, [
    isReady,
    evaluated,
    isSample,
    isLoading,
    activeError,
    blockedReason,
    pendingConfirmationCount,
    rejectedGroupCount,
    onStateChange,
    onExpensesChange,
  ]);

  const updateMapping = (nextMapping: ColumnMapping) => {
    const hadGrouping = assignments.length > 0;
    setMapping(nextMapping);
    setAssignments([]);
    setSelectedIndices([]);
    setGroupNameInput("");
    setGroupingError(null);
    setConfirmGroupId(null);
    setMappingNotice(
      hadGrouping
        ? "Grouping was cleared because the column mapping changed."
        : null,
    );
  };

  const reconcileRowChange = (
    rawIdx: number,
    nextOverrides: Record<number, RawRow>,
    nextSkipped: Set<number>,
  ) => {
    let nextAssignments = assignments.map((a) => {
      if (!a.rawIndices.includes(rawIdx)) return a;
      if (a.confirmed === undefined && a.confirmedFor === undefined) return a;
      return {
        groupId: a.groupId,
        mode: a.mode,
        rawIndices: a.rawIndices,
        ...(a.name !== undefined ? { name: a.name } : {}),
      };
    });

    let nextSelected = selectedIndices;
    let closeDialog = false;

    if (mapping && rawRows.length > 0) {
      const nextEval = evaluateMappedRows(
        rawRows,
        mapping,
        nextOverrides,
        nextSkipped,
        nextAssignments,
      );
      if (nextEval.ok) {
        const selectableSet = new Set(
          nextEval.previews
            .filter(
              (p) => p.status === "valid" && (p.transaction?.amountCents ?? 0) > 0,
            )
            .map((p) => p.rawIndex),
        );
        nextSelected = nextSelected.filter((idx) => selectableSet.has(idx));

        const appliedIds = new Set(
          nextEval.groupReports
            .filter((r) => r.status === "applied")
            .map((r) => r.groupId),
        );
        const needsConfirmIds = new Set(
          nextEval.groupReports
            .filter((r) => r.status === "needs_confirmation")
            .map((r) => r.groupId),
        );
        nextAssignments = nextAssignments.map((a) => {
          if (
            !appliedIds.has(a.groupId) &&
            (a.confirmed !== undefined || a.confirmedFor !== undefined)
          ) {
            return {
              groupId: a.groupId,
              mode: a.mode,
              rawIndices: a.rawIndices,
              ...(a.name !== undefined ? { name: a.name } : {}),
            };
          }
          return a;
        });

        if (confirmGroupId !== null && !needsConfirmIds.has(confirmGroupId)) {
          closeDialog = true;
        }
      }
    }

    setAssignments(nextAssignments);
    setSelectedIndices(nextSelected);
    if (closeDialog) setConfirmGroupId(null);
  };

  const handleToggleRow = (rawIdx: number) => {
    setGroupingError(null);
    setSelectedIndices((prev) =>
      prev.includes(rawIdx)
        ? prev.filter((idx) => idx !== rawIdx)
        : [...prev, rawIdx].sort((a, b) => a - b),
    );
  };

  const handleSelectIndices = (rawIndices: readonly number[]) => {
    if (!evaluated || !evaluated.ok) return;
    const selectableSet = new Set(
      evaluated.previews
        .filter((p) => p.status === "valid" && (p.transaction?.amountCents ?? 0) > 0)
        .map((p) => p.rawIndex),
    );
    const next = [...new Set(rawIndices.filter((idx) => selectableSet.has(idx)))].sort(
      (a, b) => a - b,
    );
    setGroupingError(null);
    setSelectedIndices(next);
  };

  const handleGroupOp = (
    op: GroupOp,
    opts?: { clearSelection?: boolean; clearName?: boolean },
  ) => {
    const res = applyGroupOp(assignments, op);
    if (!res.ok) {
      setGroupingError(res.message);
      return false;
    }
    setAssignments(res.assignments);
    setGroupingError(null);
    setMappingNotice(null);
    if (opts?.clearSelection) setSelectedIndices([]);
    if (opts?.clearName) setGroupNameInput("");
    if (
      op.type === "split" ||
      op.type === "merge" ||
      (confirmGroupId !== null && res.removedGroupIds.includes(confirmGroupId))
    ) {
      setConfirmGroupId(null);
    }
    return true;
  };

  const handleSplitSelected = () => {
    const hasCustomName = groupNameInput.trim().length > 0;
    handleGroupOp(
      {
        type: "split",
        rawIndices: activeSelectedIndices,
        ...(hasCustomName ? { name: groupNameInput } : {}),
      },
      { clearSelection: true, clearName: true },
    );
  };

  const handleMergeSelected = () => {
    const hasCustomName = groupNameInput.trim().length > 0;
    handleGroupOp(
      {
        type: "merge",
        rawIndices: activeSelectedIndices,
        ...(hasCustomName ? { name: groupNameInput } : {}),
      },
      { clearSelection: true, clearName: true },
    );
  };

  const handleConfirmGroup = (groupId: string, proposal: GroupProposal) => {
    const ok = handleGroupOp({
      type: "confirm",
      groupId,
      kinds: proposal.requires,
      proposalKey: proposal.proposalKey,
    });
    if (ok) {
      setConfirmGroupId(null);
    }
  };

  const handleUndoGroup = (groupId: string) => {
    handleGroupOp({ type: "undo", groupId });
  };

  const handleClearAllGroups = () => {
    const ok = handleGroupOp(
      { type: "clear" },
      { clearSelection: true, clearName: true },
    );
    if (ok) {
      setConfirmGroupId(null);
    }
  };

  const handleFile = async (file: File) => {
    cancelCurrentJob();
    const jobId = jobIdRef.current;

    setIsLoading(false);
    setParseError(null);
    setIsSample(false);
    setRawText(null);
    clearPreviewState();
    setFileName(null);

    if (file.size > MAX_FILE_BYTES) {
      setParseError("File exceeds the 5 MB limit. Split the export and try again.");
      return;
    }

    setFileName(file.name);

    setIsLoading(true);
    setLoadingStepIdx(0);
    try {
      const text = await file.text();
      if (!mountedRef.current || jobIdRef.current !== jobId) return;
      setRawText(text);
      runParse(text, { jobId, sample: false });
    } catch {
      if (!mountedRef.current || jobIdRef.current !== jobId) return;
      setIsLoading(false);
      setRawText(null);
      clearPreviewState();
      setParseError("Could not read this file in your browser.");
    }
  };

  const handleLoadSample = () => {
    cancelCurrentJob();
    if (mode === "paste") {
      setPasteText(DEMO_TRANSACTIONS_CSV);
      setRawText(DEMO_TRANSACTIONS_CSV);
      runParse(DEMO_TRANSACTIONS_CSV, { sample: true });
    } else {
      setFileName("sample-miller-statement.csv");
      setRawText(DEMO_TRANSACTIONS_CSV);
      runParse(DEMO_TRANSACTIONS_CSV, { sample: true });
    }
  };

  const handleRetry = () => {
    const source = mode === "paste" ? pasteText : rawText;
    if (source !== null && source.trim()) {
      const keepSample = isSample && source === DEMO_TRANSACTIONS_CSV;
      if (mode === "paste") setRawText(source);
      runParse(source, { sample: keepSample });
    }
  };

  const canRetry =
    mode === "paste" ? pasteText.trim().length > 0 : rawText !== null && rawText.trim().length > 0;

  return (
    <div className="space-y-6">
      {mode === "paste" ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <label
            htmlFor={`${uid}-paste`}
            className="block text-sm font-bold text-foreground"
          >
            Paste transactions
          </label>
          <p id={`${uid}-paste-help`} className="mt-1 text-xs text-muted-foreground">
            Supports bank statement lines or CSV text like{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              2026-10-03 NETFLIX.COM 8844 -15.49
            </code>
            . Parsed locally in your browser — raw lines are not uploaded.
          </p>
          <textarea
            id={`${uid}-paste`}
            aria-label="Paste transactions"
            rows={5}
            aria-describedby={`${uid}-paste-help`}
            value={pasteText}
            onChange={(e) => {
              const nextVal = e.target.value;
              cancelCurrentJob();
              setIsLoading(false);
              clearPreviewState();
              setParseError(null);
              setRawText(null);
              setIsSample(false);
              setPasteText(nextVal);
            }}
            placeholder={`2026-08-03 NETFLIX.COM 8844 -15.49\n2026-09-03 NETFLIX.COM 8844 -15.49\n2026-10-03 NETFLIX.COM 8844 -15.49\n2026-10-05 PLANET FITNESS #4521 NY -29.99`}
            className="mt-3 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/70"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleLoadSample}
              className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
            >
              Paste sample rows
            </button>
            <button
              type="button"
              onClick={() => {
                const keepSample = isSample && pasteText === DEMO_TRANSACTIONS_CSV;
                setRawText(pasteText);
                runParse(pasteText, { sample: keepSample });
              }}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
            >
              Preview pasted rows
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition-colors sm:p-8",
              isDragging
                ? "border-primary bg-[var(--savings-bg)]/30"
                : "border-border bg-background/50",
            )}
          >
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-primary">
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-semibold text-foreground">
              {fileName
                ? `Loaded: ${fileName}`
                : "Drop your bank or card CSV here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              UTF-8 CSV (comma, semicolon, or tab), up to 5 MB. Parsed locally
              in your browser — raw CSV rows are not uploaded.
            </p>

            <div className="mt-5 flex w-full flex-col items-stretch justify-center gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <label
                htmlFor={`${uid}-csv-input`}
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95 sm:w-auto"
              >
                <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
                <span>{fileName ? "Choose another CSV" : "Choose CSV file"}</span>
              </label>
              <input
                id={`${uid}-csv-input`}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
                className="sr-only"
              />
              <button
                type="button"
                onClick={handleLoadSample}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted sm:w-auto"
              >
                Load sample CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-border bg-card p-6"
        >
          <p className="text-sm font-semibold text-foreground">
            {LOADING_STEPS[loadingStepIdx]}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${((loadingStepIdx + 1) / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Error state + Retry */}
      {activeError && !isLoading && (
        <div
          role="alert"
          className="flex flex-col justify-between gap-3 rounded-xl border border-red-200 bg-[var(--chip-cut-bg)]/50 p-4 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle
              className="mt-0.5 size-5 shrink-0 text-[var(--chip-cut)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Unable to process transactions
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeError}
              </p>
            </div>
          </div>
          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Column Mapping Card (shown once headers & mapping are ready) */}
      {!isLoading && !parseError && mapping && headers.length > 0 && (() => {
        const hasSeparateDebit = Boolean(
          mapping.debitColumn && mapping.debitColumn !== mapping.amount,
        );
        return (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
              <h3 className="text-base font-bold text-foreground">
                Column mapping
              </h3>
              <p className="text-xs text-muted-foreground">
                Account numbers, names and balances are ignored.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label
                  htmlFor={`${uid}-map-date`}
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Date
                </label>
                <select
                  id={`${uid}-map-date`}
                  value={mapping.date}
                  onChange={(e) =>
                    updateMapping({ ...mapping, date: e.target.value })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${uid}-map-desc`}
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Description
                </label>
                <select
                  id={`${uid}-map-desc`}
                  value={mapping.description}
                  onChange={(e) =>
                    updateMapping({ ...mapping, description: e.target.value })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${uid}-map-amount`}
                  className="block text-xs font-medium text-muted-foreground"
                >
                  {hasSeparateDebit ? "Amount / Credit (incoming)" : "Amount"}
                </label>
                <select
                  id={`${uid}-map-amount`}
                  aria-describedby={`${uid}-map-split-help`}
                  value={mapping.amount}
                  onChange={(e) =>
                    updateMapping({ ...mapping, amount: e.target.value })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${uid}-map-debit`}
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Debit column (optional)
                </label>
                <select
                  id={`${uid}-map-debit`}
                  aria-describedby={`${uid}-map-split-help`}
                  value={mapping.debitColumn ?? ""}
                  onChange={(e) =>
                    updateMapping({
                      ...mapping,
                      debitColumn: e.target.value || undefined,
                    })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="">None (single Amount column)</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${uid}-map-txid`}
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Transaction ID (optional)
                </label>
                <select
                  id={`${uid}-map-txid`}
                  value={mapping.transactionId ?? ""}
                  onChange={(e) =>
                    updateMapping({
                      ...mapping,
                      transactionId: e.target.value || undefined,
                    })
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="">None</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p
              id={`${uid}-map-split-help`}
              className="mt-3 text-xs leading-relaxed text-muted-foreground"
            >
              {hasSeparateDebit
                ? `Using separate columns: "${mapping.debitColumn}" is treated as money spent (debits/charges), and "${mapping.amount}" is treated as money received (credits/refunds). Blank or 0 on the unused side is ignored.`
                : `Using a single Amount column ("${mapping.amount}") with the sign convention below. If your file has separate Debit/Credit (or Paid/Received) columns, choose the Debit column above.`}
            </p>

            <fieldset className="mt-4 border-t border-border pt-4">
              <legend className="text-xs font-semibold text-foreground">
                Debits (money spent) are:
              </legend>
              {hasSeparateDebit && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Applies to single-column statements only — separate Debit (
                  {mapping.debitColumn}) and Credit ({mapping.amount}) columns
                  already determine direction.
                </p>
              )}
              <div
                className={cn(
                  "mt-2 flex flex-wrap gap-4",
                  hasSeparateDebit && "opacity-60",
                )}
              >
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name={`${uid}-sign`}
                    value="negative_is_debit"
                    checked={mapping.signConvention === "negative_is_debit"}
                    disabled={hasSeparateDebit}
                    onChange={() =>
                      updateMapping({
                        ...mapping,
                        signConvention: "negative_is_debit",
                      })
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Negative numbers (e.g. -15.49)</span>
                </label>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name={`${uid}-sign`}
                    value="positive_is_debit"
                    checked={mapping.signConvention === "positive_is_debit"}
                    disabled={hasSeparateDebit}
                    onChange={() =>
                      updateMapping({
                        ...mapping,
                        signConvention: "positive_is_debit",
                      })
                    }
                    className="size-4 accent-primary"
                  />
                  <span>Positive numbers (e.g. 15.49)</span>
                </label>
              </div>
            </fieldset>
          </div>
        );
      })()}

      {/* Mapping notice fallback when preview itself errored or is loading */}
      {mappingNotice && (isLoading || !evaluated || !evaluated.ok) && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-xl border border-[var(--chip-negotiate)]/35 bg-[var(--chip-negotiate-bg)] px-4 py-3 text-sm text-[var(--chip-negotiate)]"
        >
          <div className="flex items-start gap-2">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mappingNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setMappingNotice(null)}
            aria-label="Dismiss column mapping notice"
            className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Empty state before input */}
      {!isLoading && !activeError && rawRows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {mode === "paste"
              ? "Paste statement lines above to preview detected recurring bills"
              : "Upload a CSV statement above to map columns and preview rows"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            No bank login required. Refunds and duplicate transaction IDs are
            automatically excluded.
          </p>
        </div>
      )}

      {/* Manual grouping + preview rows & detected recurring summary */}
      {!isLoading && evaluated && evaluated.ok && mapping && (
        <>
          <GroupingPanel
            previews={evaluated.previews}
            expenses={evaluated.expenses}
            assignments={assignments}
            groupReports={evaluated.groupReports}
            selectedIndices={activeSelectedIndices}
            groupNameInput={groupNameInput}
            groupingError={groupingError}
            mappingNotice={mappingNotice}
            blockedReason={blockedReason}
            onGroupNameChange={(val) => {
              setGroupingError(null);
              setGroupNameInput(val);
            }}
            onSplitSelected={handleSplitSelected}
            onMergeSelected={handleMergeSelected}
            onClearSelection={() => {
              setGroupingError(null);
              setSelectedIndices([]);
            }}
            onUndoGroup={handleUndoGroup}
            onClearAllGroups={handleClearAllGroups}
            onRequestConfirm={(groupId) => setConfirmGroupId(groupId)}
            onDismissError={() => setGroupingError(null)}
            onDismissNotice={() => setMappingNotice(null)}
          />

          <PreviewRows
            previews={evaluated.previews}
            expenses={evaluated.expenses}
            sources={evaluated.sources}
            assignments={assignments}
            groupReports={evaluated.groupReports}
            selectedIndices={activeSelectedIndices}
            onToggleRow={handleToggleRow}
            onSelectIndices={handleSelectIndices}
            mapping={mapping}
            validCount={evaluated.validCount}
            attentionCount={evaluated.attentionCount}
            excludedCount={evaluated.excludedCount}
            onFixRow={(rawIdx, updated) => {
              const nextOverrides = { ...overrides, [rawIdx]: updated };
              setOverrides(nextOverrides);
              reconcileRowChange(rawIdx, nextOverrides, skippedIndices);
            }}
            onSkipRow={(rawIdx) => {
              const nextSkipped = new Set(skippedIndices);
              nextSkipped.add(rawIdx);
              setSkippedIndices(nextSkipped);
              reconcileRowChange(rawIdx, overrides, nextSkipped);
            }}
            onRestoreRow={(rawIdx) => {
              const nextSkipped = new Set(skippedIndices);
              nextSkipped.delete(rawIdx);
              setSkippedIndices(nextSkipped);
              reconcileRowChange(rawIdx, overrides, nextSkipped);
            }}
          />

          <GroupConfirmDialog
            open={effectiveConfirmGroupId !== null}
            groupId={effectiveConfirmGroupId}
            assignment={
              effectiveConfirmGroupId
                ? (assignments.find(
                    (a) => a.groupId === effectiveConfirmGroupId,
                  ) ?? null)
                : null
            }
            report={
              effectiveConfirmGroupId
                ? (evaluated.groupReports.find(
                    (r) => r.groupId === effectiveConfirmGroupId,
                  ) ?? null)
                : null
            }
            previews={evaluated.previews}
            mapping={mapping}
            onConfirm={handleConfirmGroup}
            onCancel={() => setConfirmGroupId(null)}
          />
        </>
      )}
    </div>
  );
}
