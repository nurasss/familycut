"use client";

import { useState } from "react";
import { AlertTriangle, Check, MinusCircle, Pencil } from "lucide-react";
import { annualCents } from "@/lib/engine/money";
import { formatUsd } from "@/lib/format";
import type { ColumnMapping, Expense, RawRow } from "@/lib/types";
import type { RowPreviewItem } from "@/components/audit/import-adapter";
import { FREQUENCY_SHORT } from "@/components/money-input";
import { ConfidencePill } from "@/components/ui-badges";
import { cn } from "@/lib/utils";

type PreviewRowsProps = {
  previews: RowPreviewItem[];
  expenses: Expense[];
  mapping: ColumnMapping;
  validCount: number;
  attentionCount: number;
  excludedCount: number;
  onFixRow: (rawIndex: number, updated: RawRow) => void;
  onSkipRow: (rawIndex: number) => void;
};

function RowStatusBadge({ item }: { item: RowPreviewItem }) {
  if (item.status === "valid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--savings-bg)] px-2.5 py-0.5 text-xs font-medium text-primary">
        <Check className="size-3" aria-hidden="true" />
        <span>Valid</span>
      </span>
    );
  }
  if (item.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--chip-negotiate-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--chip-negotiate)]">
        <AlertTriangle className="size-3" aria-hidden="true" />
        <span>{item.reason ?? "Needs attention"} — fix or skip</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <MinusCircle className="size-3" aria-hidden="true" />
      <span>{item.reason ?? "Excluded"}</span>
    </span>
  );
}

function ErrorRowEditor({
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
  const [dateVal, setDateVal] = useState(item.raw[mapping.date] ?? "");
  const [descVal, setDescVal] = useState(item.raw[mapping.description] ?? "");
  const amountCol = mapping.debitColumn ?? mapping.amount;
  const [amtVal, setAmtVal] = useState(item.raw[amountCol] ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...item.raw,
      [mapping.date]: dateVal,
      [mapping.description]: descVal,
      [amountCol]: amtVal,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 grid grid-cols-1 gap-2.5 rounded-lg border border-border bg-background p-3 sm:grid-cols-12 sm:items-end"
    >
      <div className="sm:col-span-3">
        <label
          htmlFor={`fix-date-${item.rawIndex}`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Date (YYYY-MM-DD)
        </label>
        <input
          id={`fix-date-${item.rawIndex}`}
          type="text"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
          placeholder="2026-10-03"
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground"
        />
      </div>
      <div className="sm:col-span-4">
        <label
          htmlFor={`fix-desc-${item.rawIndex}`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Description
        </label>
        <input
          id={`fix-desc-${item.rawIndex}`}
          type="text"
          value={descVal}
          onChange={(e) => setDescVal(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground"
        />
      </div>
      <div className="sm:col-span-2">
        <label
          htmlFor={`fix-amt-${item.rawIndex}`}
          className="block text-xs font-medium text-muted-foreground"
        >
          Amount
        </label>
        <input
          id={`fix-amt-${item.rawIndex}`}
          type="text"
          value={amtVal}
          onChange={(e) => setAmtVal(e.target.value)}
          placeholder="-15.49"
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground tabular-nums"
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-3 sm:justify-end">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground"
        >
          Save fix
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

export function PreviewRows({
  previews,
  expenses,
  mapping,
  validCount,
  attentionCount,
  excludedCount,
  onFixRow,
  onSkipRow,
}: PreviewRowsProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);

  // Surface rows needing attention first, then remaining rows
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
            {expenses.map((exp) => (
              <li
                key={exp.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background/60 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {exp.merchant}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {exp.reasons[0] ?? exp.category}
                  </p>
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
            ))}
          </ul>
        </div>
      )}

      {/* Mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {visiblePreviews.map((item) => {
          const date = item.raw[mapping.date] ?? "";
          const desc = item.raw[mapping.description] ?? "";
          const amt =
            (mapping.debitColumn ? item.raw[mapping.debitColumn] : "") ||
            item.raw[mapping.amount] ||
            "";
          const isEditing = editingIdx === item.rawIndex;

          return (
            <div
              key={item.rawIndex}
              className={cn(
                "rounded-xl border bg-card p-3.5",
                item.status === "error"
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {desc || "(No description)"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    Line {item.lineNumber} · {date || "Missing date"} ·{" "}
                    {amt || "Missing amount"}
                  </p>
                </div>
                <RowStatusBadge item={item} />
              </div>

              {item.status === "error" && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingIdx(isEditing ? null : item.rawIndex)
                    }
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    <span>Fix</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIdx(null);
                      onSkipRow(item.rawIndex);
                    }}
                    className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground"
                  >
                    Skip
                  </button>
                </div>
              )}

              {isEditing && (
                <ErrorRowEditor
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
            Parsed statement rows preview with status and fix controls
          </caption>
          <thead className="border-b border-border bg-muted/60 text-xs font-semibold text-muted-foreground">
            <tr>
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
                Amount
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
              const amt =
                (mapping.debitColumn ? item.raw[mapping.debitColumn] : "") ||
                item.raw[mapping.amount] ||
                "";
              const isEditing = editingIdx === item.rawIndex;

              return (
                <tr
                  key={item.rawIndex}
                  className={cn(
                    item.status === "error" && "bg-amber-50/40",
                    item.status === "skipped" && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                    {item.lineNumber}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground tabular-nums whitespace-nowrap">
                    {date || "—"}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-sm font-medium text-foreground">
                    <span className="block truncate">{desc || "—"}</span>
                    {isEditing && (
                      <ErrorRowEditor
                        item={item}
                        mapping={mapping}
                        onSave={(updated) => {
                          setEditingIdx(null);
                          onFixRow(item.rawIndex, updated);
                        }}
                        onCancel={() => setEditingIdx(null)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-foreground tabular-nums whitespace-nowrap">
                    {amt || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <RowStatusBadge item={item} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.status === "error" && (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingIdx(isEditing ? null : item.rawIndex)
                          }
                          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
                        >
                          Fix
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingIdx(null);
                            onSkipRow(item.rawIndex);
                          }}
                          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
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
