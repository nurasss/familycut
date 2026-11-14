"use client";

import { Fragment, useId, useState } from "react";
import { AlertTriangle, Check, MinusCircle, Pencil, RotateCcw } from "lucide-react";
import type {
  ExpenseSource,
  GroupAssignment,
  GroupReport,
} from "@/lib/engine/grouping";
import { annualCents } from "@/lib/engine/money";
import { parseAmountCents } from "@/lib/engine/parse";
import { formatUsd } from "@/lib/format";
import type { ColumnMapping, Expense, RawRow } from "@/lib/types";
import type { RowPreviewItem } from "@/components/audit/import-adapter";
import { FREQUENCY_SHORT } from "@/components/money-input";
import { ConfidencePill } from "@/components/ui-badges";
import { cn } from "@/lib/utils";

type PreviewRowsProps = {
  previews: RowPreviewItem[];
  expenses: Expense[];
  sources?: readonly ExpenseSource[];
  assignments?: readonly GroupAssignment[];
  groupReports?: readonly GroupReport[];
  selectedIndices?: readonly number[];
  onToggleRow?: (rawIndex: number) => void;
  onSelectIndices?: (rawIndices: readonly number[]) => void;
  mapping: ColumnMapping;
  validCount: number;
  attentionCount: number;
  excludedCount: number;
  onFixRow: (rawIndex: number, updated: RawRow) => void;
  onSkipRow: (rawIndex: number) => void;
  onRestoreRow?: (rawIndex: number) => void;
};

function formatPreviewAmount(raw: RawRow, mapping: ColumnMapping): string {
  if (mapping.debitColumn && mapping.debitColumn !== mapping.amount) {
    const debitRaw = (raw[mapping.debitColumn] ?? "").trim();
    const creditRaw = (raw[mapping.amount] ?? "").trim();
    const debitCents = debitRaw ? parseAmountCents(debitRaw) : null;
    const creditCents = creditRaw ? parseAmountCents(creditRaw) : null;

    const hasNonZeroDebit = debitCents !== null && debitCents !== 0;
    const hasNonZeroCredit = creditCents !== null && creditCents !== 0;

    if (hasNonZeroDebit && !hasNonZeroCredit) {
      return debitRaw;
    }
    if (hasNonZeroCredit && !hasNonZeroDebit) {
      return `Credit: ${creditRaw}`;
    }
    if (hasNonZeroDebit && hasNonZeroCredit) {
      return `Debit: ${debitRaw} / Credit: ${creditRaw}`;
    }
    if (debitRaw && debitCents === null) return debitRaw;
    if (creditRaw && creditCents === null) return creditRaw;
    return debitRaw || creditRaw || "";
  }
  return raw[mapping.amount] ?? "";
}

function RowStatusBadge({ item }: { item: RowPreviewItem }) {
  if (item.status === "valid") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--savings-bg)] px-2.5 py-0.5 text-xs font-medium text-primary">
        <Check className="size-3 shrink-0" aria-hidden="true" />
        <span>Valid</span>
      </span>
    );
  }
  if (item.status === "error") {
    return (
      <span className="inline-flex max-w-full min-w-0 items-start gap-1 rounded-full bg-[var(--chip-negotiate-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--chip-negotiate)]">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {item.reason ?? "Needs attention"}
        </span>
      </span>
    );
  }
  if (item.status === "skipped") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        <MinusCircle className="size-3 shrink-0" aria-hidden="true" />
        <span>Excluded</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full min-w-0 items-start gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <MinusCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {item.reason ?? "Excluded"}
      </span>
    </span>
  );
}

function RowEditor({
  item,
  mapping,
  onSave,
  onCancel,
}: {
  item: RowPreviewItem;
  mapping: ColumnMapping;
  onSave: (updated: RawRow) => void;
  onCancel: () => void;
}) {
  const editorUid = useId();
  const hasSeparateDebit = Boolean(
    mapping.debitColumn && mapping.debitColumn !== mapping.amount,
  );

  const [dateVal, setDateVal] = useState(item.raw[mapping.date] ?? "");
  const [descVal, setDescVal] = useState(item.raw[mapping.description] ?? "");
  const [debitVal, setDebitVal] = useState(
    hasSeparateDebit && mapping.debitColumn
      ? (item.raw[mapping.debitColumn] ?? "")
      : "",
  );
  const [creditOrAmountVal, setCreditOrAmountVal] = useState(
    item.raw[mapping.amount] ?? "",
  );

  const errorDescId =
    item.status === "error" && item.reason ? `${editorUid}-err` : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasSeparateDebit && mapping.debitColumn) {
      onSave({
        ...item.raw,
        [mapping.date]: dateVal,
        [mapping.description]: descVal,
        [mapping.debitColumn]: debitVal,
        [mapping.amount]: creditOrAmountVal,
      });
      return;
    }
    onSave({
      ...item.raw,
      [mapping.date]: dateVal,
      [mapping.description]: descVal,
      [mapping.amount]: creditOrAmountVal,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 grid grid-cols-1 gap-2.5 rounded-lg border border-border bg-background p-3 sm:grid-cols-12 sm:items-end"
    >
      {errorDescId && (
        <p
          id={errorDescId}
          role="status"
          className="text-xs font-medium text-[var(--chip-negotiate)] sm:col-span-12"
        >
          Row issue: {item.reason}
        </p>
      )}
      <div className="sm:col-span-3">
        <label
          htmlFor={`${editorUid}-date`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Date (YYYY-MM-DD)
        </label>
        <input
          id={`${editorUid}-date`}
          type="text"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
          placeholder="2026-10-03"
          aria-describedby={errorDescId}
          aria-invalid={errorDescId ? "true" : undefined}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground"
        />
      </div>
      <div className={hasSeparateDebit ? "sm:col-span-3" : "sm:col-span-4"}>
        <label
          htmlFor={`${editorUid}-desc`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Description
        </label>
        <input
          id={`${editorUid}-desc`}
          type="text"
          value={descVal}
          onChange={(e) => setDescVal(e.target.value)}
          aria-describedby={errorDescId}
          aria-invalid={errorDescId ? "true" : undefined}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground"
        />
      </div>
      {hasSeparateDebit && mapping.debitColumn ? (
        <>
          <div className="sm:col-span-2">
            <label
              htmlFor={`${editorUid}-debit`}
              className="block text-xs font-medium text-muted-foreground"
            >
              Debit ({mapping.debitColumn})
            </label>
            <input
              id={`${editorUid}-debit`}
              type="text"
              inputMode="decimal"
              value={debitVal}
              onChange={(e) => setDebitVal(e.target.value)}
              placeholder="0.00"
              aria-describedby={errorDescId}
              aria-invalid={errorDescId ? "true" : undefined}
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground tabular-nums"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor={`${editorUid}-credit`}
              className="block text-xs font-medium text-muted-foreground"
            >
              Credit ({mapping.amount})
            </label>
            <input
              id={`${editorUid}-credit`}
              type="text"
              inputMode="decimal"
              value={creditOrAmountVal}
              onChange={(e) => setCreditOrAmountVal(e.target.value)}
              placeholder="0.00"
              aria-describedby={errorDescId}
              aria-invalid={errorDescId ? "true" : undefined}
              className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground tabular-nums"
            />
          </div>
        </>
      ) : (
        <div className="sm:col-span-2">
          <label
            htmlFor={`${editorUid}-amt`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Amount ({mapping.amount})
          </label>
          <input
            id={`${editorUid}-amt`}
            type="text"
            inputMode="decimal"
            value={creditOrAmountVal}
            onChange={(e) => setCreditOrAmountVal(e.target.value)}
            placeholder="-15.49"
            aria-describedby={errorDescId}
            aria-invalid={errorDescId ? "true" : undefined}
            className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground tabular-nums"
          />
        </div>
      )}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 sm:justify-end",
          hasSeparateDebit ? "sm:col-span-2" : "sm:col-span-3",
        )}
      >
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground"
        >
          Save row
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowMembershipMeta({
  expense,
  groupReport,
  assignment,
}: {
  expense: Expense | undefined;
  groupReport: GroupReport | undefined;
  assignment: GroupAssignment | undefined;
}) {
  if (!expense && !groupReport) return null;

  let groupLabel: string | null = null;
  if (groupReport) {
    const modeLabel = assignment?.mode === "split" ? "Split" : "Merge";
    const nameOrId = assignment?.name ?? groupReport.groupId;
    const isNoExpense =
      groupReport.status === "applied" &&
      groupReport.issues.some((i) => i.code === "no_expense");
    const statusText =
      groupReport.status === "applied" && isNoExpense
        ? "applied, no expense"
        : groupReport.status === "needs_confirmation"
          ? "needs confirmation"
          : groupReport.status === "inactive"
            ? "inactive (not applied)"
            : groupReport.status;
    groupLabel = `${modeLabel}: ${nameOrId} (${statusText})`;
  }

  return (
    <div className="mt-1 flex min-w-0 max-w-full flex-wrap gap-1.5 text-[11px] leading-4 text-muted-foreground">
      {groupLabel ? (
        <span className="inline-block max-w-full min-w-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-medium text-foreground [overflow-wrap:anywhere]">
          {groupLabel}
        </span>
      ) : null}
      {expense ? (
        <span className="inline-block max-w-full min-w-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground [overflow-wrap:anywhere]">
          Expense: {expense.merchant}
        </span>
      ) : null}
    </div>
  );
}

export function PreviewRows({
  previews,
  expenses,
  sources = [],
  assignments = [],
  groupReports = [],
  selectedIndices = [],
  onToggleRow,
  onSelectIndices,
  mapping,
  validCount,
  attentionCount,
  excludedCount,
  onFixRow,
  onSkipRow,
  onRestoreRow,
}: PreviewRowsProps) {
  const uid = useId();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);

  const selectedSet = new Set(selectedIndices);
  const expenseById = new Map(expenses.map((exp) => [exp.id, exp]));
  const sourceByExpenseId = new Map(
    sources.map((src) => [src.expenseId, src]),
  );
  const groupReportById = new Map(
    groupReports.map((report) => [report.groupId, report]),
  );
  const assignmentById = new Map(assignments.map((a) => [a.groupId, a]));

  const isRowSelectable = (item: RowPreviewItem): boolean =>
    item.status === "valid" && (item.transaction?.amountCents ?? 0) > 0;

  const hasSeparateDebit = Boolean(
    mapping.debitColumn && mapping.debitColumn !== mapping.amount,
  );

  // Surface rows needing attention first, then remaining rows in file order
  const sortedPreviews = [...previews].sort((a, b) => {
    if (a.status === "error" && b.status !== "error") return -1;
    if (a.status !== "error" && b.status === "error") return 1;
    return a.rawIndex - b.rawIndex;
  });

  const visiblePreviews = showAllRows
    ? sortedPreviews
    : sortedPreviews.slice(0, 12);

  return (
    <div className="space-y-5">
      {/* Row summary counter */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3"
      >
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {validCount} valid rows · {attentionCount} needs attention ·{" "}
          {excludedCount} excluded
        </p>
        <p className="text-xs text-muted-foreground">
          {expenses.length} recurring{" "}
          {expenses.length === 1 ? "candidate" : "candidates"} detected
        </p>
      </div>

      {/* Detected recurring candidates preview */}
      {expenses.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-bold text-foreground">
            Detected recurring expenses ({expenses.length})
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Nothing is cancelled automatically. Review and choose actions on the
            next step.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {expenses.map((exp) => {
              const source = sourceByExpenseId.get(exp.id);
              const sourceCount = source?.sourceIndices.length ?? 0;

              return (
                <li
                  key={exp.id}
                  className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-background/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {exp.merchant}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {exp.reasons.length > 0
                        ? exp.reasons.join(" · ")
                        : exp.category}
                    </p>
                    {onSelectIndices && sourceCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => onSelectIndices(source!.sourceIndices)}
                        className="mt-1.5 inline-flex min-h-8 items-center rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        Select rows ({sourceCount})
                      </button>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-foreground tabular-nums">
                      {formatUsd(exp.priceCents)}/
                      {FREQUENCY_SHORT[exp.frequency]}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatUsd(annualCents(exp.priceCents, exp.frequency))}/yr
                    </p>
                    <ConfidencePill
                      confidence={exp.confidence}
                      className="mt-1"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Mobile cards */}
      <div className="min-w-0 space-y-2.5 md:hidden">
        {visiblePreviews.map((item) => {
          const date = item.raw[mapping.date] ?? "";
          const desc = item.raw[mapping.description] ?? "";
          const amt = formatPreviewAmount(item.raw, mapping);
          const isEditing = editingIdx === item.rawIndex;
          const selectable = isRowSelectable(item);
          const isSelected = selectedSet.has(item.rawIndex);
          const checkboxId = `${uid}-select-mobile-${item.rawIndex}`;
          const sourceExpense = item.expenseId
            ? expenseById.get(item.expenseId)
            : undefined;
          const groupReport = item.groupId
            ? groupReportById.get(item.groupId)
            : undefined;
          const assignment = item.groupId
            ? assignmentById.get(item.groupId)
            : undefined;

          return (
            <div
              key={item.rawIndex}
              className={cn(
                "min-w-0 rounded-xl border bg-card p-3.5",
                isSelected
                  ? "border-primary bg-[var(--savings-bg)]/20"
                  : item.status === "error"
                    ? "border-amber-300 bg-amber-50/40"
                    : item.status === "skipped"
                      ? "border-border opacity-75"
                      : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {selectable && onToggleRow ? (
                    <label
                      htmlFor={checkboxId}
                      className="-ml-2 -mt-2 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow(item.rawIndex)}
                        className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                      />
                      <span className="sr-only">
                        Select line {item.lineNumber}: {desc || "row"} on{" "}
                        {date || "unknown date"} for {amt || "unknown amount"}
                      </span>
                    </label>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {desc || "(No description)"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      Line {item.lineNumber} · {date || "Missing date"} ·{" "}
                      {amt || "Missing amount"}
                    </p>
                    <RowMembershipMeta
                      expense={sourceExpense}
                      groupReport={groupReport}
                      assignment={assignment}
                    />
                  </div>
                </div>
                <div className="max-w-full min-w-0">
                  <RowStatusBadge item={item} />
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {item.status === "skipped" ? (
                  <button
                    type="button"
                    onClick={() => onRestoreRow?.(item.rawIndex)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    <span>
                      Restore
                      <span className="sr-only"> line {item.lineNumber}</span>
                    </span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingIdx(isEditing ? null : item.rawIndex)
                      }
                      aria-expanded={isEditing}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      <span>
                        {isEditing ? "Close" : "Edit"}
                        <span className="sr-only"> line {item.lineNumber}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingIdx(null);
                        onSkipRow(item.rawIndex);
                      }}
                      className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      Exclude
                      <span className="sr-only"> line {item.lineNumber}</span>
                    </button>
                  </>
                )}
              </div>

              {isEditing && item.status !== "skipped" && (
                <RowEditor
                  item={item}
                  mapping={mapping}
                  onSave={(updated) => {
                    setEditingIdx(null);
                    onFixRow(item.rawIndex, updated);
                  }}
                  onCancel={() => setEditingIdx(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Parsed statement rows preview with row selection, status and edit
            controls
          </caption>
          <thead className="border-b border-border bg-muted/60 text-xs font-semibold text-muted-foreground">
            <tr>
              <th scope="col" className="w-12 px-2 py-3 text-center">
                Select
              </th>
              <th scope="col" className="px-4 py-3">
                Line
              </th>
              <th scope="col" className="px-4 py-3">
                Date
              </th>
              <th scope="col" className="px-4 py-3">
                Description
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                {hasSeparateDebit ? "Debit / Credit" : "Amount"}
              </th>
              <th scope="col" className="px-4 py-3">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visiblePreviews.map((item) => {
              const date = item.raw[mapping.date] ?? "";
              const desc = item.raw[mapping.description] ?? "";
              const amt = formatPreviewAmount(item.raw, mapping);
              const isEditing = editingIdx === item.rawIndex;
              const selectable = isRowSelectable(item);
              const isSelected = selectedSet.has(item.rawIndex);
              const checkboxId = `${uid}-select-desktop-${item.rawIndex}`;
              const sourceExpense = item.expenseId
                ? expenseById.get(item.expenseId)
                : undefined;
              const groupReport = item.groupId
                ? groupReportById.get(item.groupId)
                : undefined;
              const assignment = item.groupId
                ? assignmentById.get(item.groupId)
                : undefined;

              return (
                <Fragment key={item.rawIndex}>
                  <tr
                    className={cn(
                      isSelected && "bg-[var(--savings-bg)]/20",
                      item.status === "error" && "bg-amber-50/40",
                      item.status === "skipped" && "opacity-65",
                    )}
                  >
                    <td className="px-2 py-1.5 text-center">
                      {selectable && onToggleRow ? (
                        <label
                          htmlFor={checkboxId}
                          className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md"
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleRow(item.rawIndex)}
                            className="h-4 w-4 rounded border-border accent-[var(--primary)]"
                          />
                          <span className="sr-only">
                            Select line {item.lineNumber}: {desc || "row"} on{" "}
                            {date || "unknown date"} for{" "}
                            {amt || "unknown amount"}
                          </span>
                        </label>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="text-xs text-muted-foreground/60"
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {item.lineNumber}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground tabular-nums whitespace-nowrap">
                      {date || "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-sm font-medium text-foreground">
                      <span className="block truncate">{desc || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-foreground tabular-nums whitespace-nowrap">
                      {amt || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <RowStatusBadge item={item} />
                      <RowMembershipMeta
                        expense={sourceExpense}
                        groupReport={groupReport}
                        assignment={assignment}
                      />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {item.status === "skipped" ? (
                          <button
                            type="button"
                            onClick={() => onRestoreRow?.(item.rawIndex)}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            <span>
                              Restore
                              <span className="sr-only">
                                {" "}
                                line {item.lineNumber}
                              </span>
                            </span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingIdx(isEditing ? null : item.rawIndex)
                              }
                              aria-expanded={isEditing}
                              className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
                            >
                              {isEditing ? "Close" : "Edit"}
                              <span className="sr-only">
                                {" "}
                                line {item.lineNumber}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingIdx(null);
                                onSkipRow(item.rawIndex);
                              }}
                              className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                            >
                              Exclude
                              <span className="sr-only">
                                {" "}
                                line {item.lineNumber}
                              </span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isEditing && item.status !== "skipped" && (
                    <tr className="bg-muted/20">
                      <td colSpan={7} className="px-4 pb-4 pt-1">
                        <RowEditor
                          item={item}
                          mapping={mapping}
                          onSave={(updated) => {
                            setEditingIdx(null);
                            onFixRow(item.rawIndex, updated);
                          }}
                          onCancel={() => setEditingIdx(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedPreviews.length > 12 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowAllRows((prev) => !prev)}
            className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
          >
            {showAllRows
              ? "Show fewer rows"
              : `Show all ${sortedPreviews.length} rows`}
          </button>
        </div>
      )}
    </div>
  );
}
