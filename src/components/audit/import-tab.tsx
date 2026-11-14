"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { DEMO_TRANSACTIONS_CSV } from "@/lib/fixtures/miller";
import type { ColumnMapping, Expense, RawRow } from "@/lib/types";
import {
  MAX_FILE_BYTES,
  evaluateMappedRows,
  parseInputRows,
} from "@/components/audit/import-adapter";
import { PreviewRows } from "@/components/audit/preview-rows";
import { cn } from "@/lib/utils";

type ImportTabProps = {
  mode: "paste" | "csv";
  onExpensesChange: (expenses: Expense[]) => void;
};

const LOADING_STEPS = [
  "Parsing rows locally in your browser…",
  "Normalizing merchant names…",
  "Checking recurring charge intervals…",
];

export function ImportTab({ mode, onExpensesChange }: ImportTabProps) {
  const uid = useId();
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RawRow>>({});
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);

  const runParse = (text: string) => {
    setParseError(null);
    setOverrides({});
    setSkippedIndices(new Set());

    if (!text.trim()) {
      setRawRows([]);
      setHeaders([]);
      setMapping(null);
      onExpensesChange([]);
      return;
    }

    setIsLoading(true);
    setLoadingStepIdx(0);

    // Brief async yield so loading steps render visibly and UI stays responsive
    const timer1 = setTimeout(() => setLoadingStepIdx(1), 80);
    const timer2 = setTimeout(() => setLoadingStepIdx(2), 160);
    const timer3 = setTimeout(() => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      const parsed = parseInputRows(mode, text);
      setIsLoading(false);

      if (!parsed.ok) {
        setRawRows([]);
        setHeaders([]);
        setMapping(null);
        setParseError(parsed.error);
        onExpensesChange([]);
        return;
      }

      if (parsed.rows.length === 0) {
        setRawRows([]);
        setHeaders([]);
        setMapping(null);
        setParseError("No transaction rows found. Check the format and try again.");
        onExpensesChange([]);
        return;
      }

      setRawRows(parsed.rows);
      setHeaders(parsed.headers);
      setMapping(parsed.mapping);
    }, 240);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  };

  const evaluated = useMemo(() => {
    if (rawRows.length === 0 || !mapping) return null;
    return evaluateMappedRows(rawRows, mapping, overrides, skippedIndices);
  }, [rawRows, mapping, overrides, skippedIndices]);

  useEffect(() => {
    if (evaluated && evaluated.ok) {
      onExpensesChange(evaluated.expenses);
    } else {
      onExpensesChange([]);
    }
  }, [evaluated, onExpensesChange]);

  const handleFile = async (file: File) => {
    setParseError(null);
    if (file.size > MAX_FILE_BYTES) {
      setParseError("File exceeds the 5 MB limit. Split the export and try again.");
      return;
    }
    setFileName(file.name);
    try {
      const text = await file.text();
      setRawText(text);
      runParse(text);
    } catch {
      setParseError("Could not read this file in your browser.");
    }
  };

  const handleLoadSample = () => {
    if (mode === "paste") {
      setPasteText(DEMO_TRANSACTIONS_CSV);
      setRawText(DEMO_TRANSACTIONS_CSV);
      runParse(DEMO_TRANSACTIONS_CSV);
    } else {
      setFileName("sample-miller-statement.csv");
      setRawText(DEMO_TRANSACTIONS_CSV);
      runParse(DEMO_TRANSACTIONS_CSV);
    }
  };

  const handleRetry = () => {
    const source = mode === "paste" ? pasteText : rawText;
    if (source) runParse(source);
  };

  const activeError =
    parseError ?? (evaluated && !evaluated.ok ? evaluated.error : null);

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
            . Processed locally in your browser.
          </p>
          <textarea
            id={`${uid}-paste`}
            aria-label="Paste transactions"
            rows={5}
            aria-describedby={`${uid}-paste-help`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
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
                setRawText(pasteText);
                runParse(pasteText);
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
              UTF-8 CSV (comma, semicolon, or tab), up to 5 MB. Nothing is
              uploaded to any server.
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
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Column Mapping Card (shown once headers & mapping are ready) */}
      {!isLoading && !parseError && mapping && headers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
            <h3 className="text-base font-bold text-foreground">
              Column mapping
            </h3>
            <p className="text-xs text-muted-foreground">
              Account numbers, names and balances are ignored.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  setMapping({ ...mapping, date: e.target.value })
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
                  setMapping({ ...mapping, description: e.target.value })
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
                Amount
              </label>
              <select
                id={`${uid}-map-amount`}
                value={mapping.amount}
                onChange={(e) =>
                  setMapping({ ...mapping, amount: e.target.value })
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
                htmlFor={`${uid}-map-txid`}
                className="block text-xs font-medium text-muted-foreground"
              >
                Transaction ID (optional)
              </label>
              <select
                id={`${uid}-map-txid`}
                value={mapping.transactionId ?? ""}
                onChange={(e) =>
                  setMapping({
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

          <fieldset className="mt-4 border-t border-border pt-4">
            <legend className="text-xs font-semibold text-foreground">
              Debits (money spent) are:
            </legend>
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name={`${uid}-sign`}
                  value="negative_is_debit"
                  checked={mapping.signConvention === "negative_is_debit"}
                  onChange={() =>
                    setMapping({
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
                  onChange={() =>
                    setMapping({
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

      {/* Preview rows & detected recurring summary */}
      {!isLoading && evaluated && evaluated.ok && mapping && (
        <PreviewRows
          previews={evaluated.previews}
          expenses={evaluated.expenses}
          mapping={mapping}
          validCount={evaluated.validCount}
          attentionCount={evaluated.attentionCount}
          excludedCount={evaluated.excludedCount}
          onFixRow={(rawIdx, updated) =>
            setOverrides((prev) => ({ ...prev, [rawIdx]: updated }))
          }
          onSkipRow={(rawIdx) =>
            setSkippedIndices((prev) => {
              const next = new Set(prev);
              next.add(rawIdx);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
