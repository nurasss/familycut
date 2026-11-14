"use client";

import { useId } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Info,
  Split,
  Undo2,
  X,
} from "lucide-react";
import {
  MAX_GROUP_NAME_LENGTH,
  type GroupAssignment,
  type GroupReport,
} from "@/lib/engine/grouping";
import { formatUsd } from "@/lib/format";
import type { Expense } from "@/lib/types";
import type { RowPreviewItem } from "@/components/audit/import-adapter";
import { FREQUENCY_SHORT } from "@/components/money-input";
import { cn } from "@/lib/utils";

type GroupingPanelProps = {
  previews: readonly RowPreviewItem[];
  expenses: readonly Expense[];
  assignments: readonly GroupAssignment[];
  groupReports: readonly GroupReport[];
  selectedIndices: readonly number[];
  groupNameInput: string;
  groupingError: string | null;
  mappingNotice: string | null;
  blockedReason: string | null;
  onGroupNameChange: (value: string) => void;
  onSplitSelected: () => void;
  onMergeSelected: () => void;
  onClearSelection: () => void;
  onUndoGroup: (groupId: string) => void;
  onClearAllGroups: () => void;
  onRequestConfirm: (groupId: string) => void;
  onDismissError: () => void;
  onDismissNotice: () => void;
};

function formatIgnoredReason(
  reason: GroupReport["ignoredRawIndices"][number]["reason"],
  preview: RowPreviewItem | undefined,
): string {
  if (reason === "row_in_other_group") {
    return "moved to another group";
  }
  if (preview?.status === "skipped") return "skipped";
  if (preview?.status === "error") return "needs row fix";
  if (preview?.status === "refund") return "refund";
  if (preview?.status === "credit") return "incoming credit";
  if (preview?.status === "duplicate") return "duplicate";
  if (reason === "unknown_row") {
    return "not in current rows";
  }
  return "excluded";
}

function getStatusMeta(report: GroupReport | undefined): {
  label: string;
  badgeClass: string;
  isNoExpense: boolean;
} {
  if (!report) {
    return {
      label: "Pending",
      badgeClass: "bg-muted text-muted-foreground border border-border",
      isNoExpense: false,
    };
  }

  const isNoExpense =
    report.status === "applied" &&
    report.issues.some((issue) => issue.code === "no_expense");

  if (report.status === "applied" && isNoExpense) {
    return {
      label: "Applied — no recurring expense",
      badgeClass:
        "bg-[var(--chip-keep-bg)] text-[var(--chip-keep)] border border-border",
      isNoExpense: true,
    };
  }

  if (report.status === "applied") {
    return {
      label: "Applied",
      badgeClass: "bg-[var(--savings-bg)] text-primary",
      isNoExpense: false,
    };
  }

  if (report.status === "needs_confirmation") {
    return {
      label: "Needs confirmation",
      badgeClass:
        "bg-[var(--chip-negotiate-bg)] text-[var(--chip-negotiate)]",
      isNoExpense: false,
    };
  }

  if (report.status === "rejected") {
    return {
      label: "Rejected",
      badgeClass: "bg-[var(--chip-cut-bg)] text-[var(--chip-cut)]",
      isNoExpense: false,
    };
  }

  return {
    label: "Inactive (not applied)",
    badgeClass: "bg-muted text-muted-foreground border border-border",
    isNoExpense: false,
  };
}

export function GroupingPanel({
  previews,
  expenses,
  assignments,
  groupReports,
  selectedIndices,
  groupNameInput,
  groupingError,
  mappingNotice,
  blockedReason,
  onGroupNameChange,
  onSplitSelected,
  onMergeSelected,
  onClearSelection,
  onUndoGroup,
  onClearAllGroups,
  onRequestConfirm,
  onDismissError,
  onDismissNotice,
}: GroupingPanelProps) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const nameInputId = `${uid}-name`;
  const nameHelpId = `${uid}-name-help`;

  const previewByRawIdx = new Map<number, RowPreviewItem>();
  for (const item of previews) {
    previewByRawIdx.set(item.rawIndex, item);
  }

  const expenseById = new Map<string, Expense>();
  for (const expense of expenses) {
    expenseById.set(expense.id, expense);
  }

  const reportById = new Map<string, GroupReport>();
  for (const report of groupReports) {
    reportById.set(report.groupId, report);
  }

  const selectedLineLabels = selectedIndices.map((idx) => {
    const item = previewByRawIdx.get(idx);
    return item ? `Line ${item.lineNumber}` : `Row ${idx + 1}`;
  });

  const formatLineLabel = (rawIdx: number): string => {
    const item = previewByRawIdx.get(rawIdx);
    return item ? `Line ${item.lineNumber}` : `Row ${rawIdx + 1}`;
  };

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={headingId}
            className="text-base font-bold text-foreground sm:text-lg"
          >
            Manual grouping (Split or Merge)
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
            Select active charge rows in the table below to split separate
            subscriptions sharing one merchant or merge staggered charges into
            one recurring expense before analyzing.
          </p>
        </div>

        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground tabular-nums">
          {selectedIndices.length}{" "}
          {selectedIndices.length === 1 ? "row selected" : "rows selected"}
        </span>
      </div>

      {selectedLineLabels.length > 0 ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          Selected: {selectedLineLabels.join(", ")}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <label
            htmlFor={nameInputId}
            className="block text-xs font-semibold text-foreground"
          >
            Optional service name
          </label>
          <input
            id={nameInputId}
            type="text"
            value={groupNameInput}
            onChange={(e) => onGroupNameChange(e.target.value)}
            placeholder="e.g. Streaming bundle"
            aria-describedby={nameHelpId}
            className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <p id={nameHelpId} className="mt-1 text-xs text-muted-foreground">
            Optional label (up to {MAX_GROUP_NAME_LENGTH} characters). Saved
            locally as the expense name after analyzing. Grouping rules stay in
            this preview only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSplitSelected}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <Split aria-hidden="true" className="h-4 w-4" />
            Split selected
          </button>

          <button
            type="button"
            onClick={onMergeSelected}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
          >
            <GitMerge aria-hidden="true" className="h-4 w-4" />
            Merge selected
          </button>

          {selectedIndices.length > 0 ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Clear selection
            </button>
          ) : null}

          {assignments.length > 0 ? (
            <button
              type="button"
              onClick={onClearAllGroups}
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-[var(--chip-cut)] transition-colors hover:bg-muted"
            >
              Clear all grouping
            </button>
          ) : null}
        </div>
      </div>

      {groupingError ? (
        <div
          role="alert"
          className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-[var(--chip-cut)]/30 bg-[var(--chip-cut-bg)] px-3.5 py-2.5 text-sm text-[var(--chip-cut)]"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="break-words">{groupingError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss grouping error"
            className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {mappingNotice ? (
        <div
          role="status"
          className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-[var(--chip-negotiate)]/35 bg-[var(--chip-negotiate-bg)] px-3.5 py-2.5 text-sm text-[var(--chip-negotiate)]"
        >
          <div className="flex items-start gap-2">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{mappingNotice}</span>
          </div>
          <button
            type="button"
            onClick={onDismissNotice}
            aria-label="Dismiss column mapping notice"
            className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {blockedReason ? (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--chip-negotiate)]/35 bg-[var(--chip-negotiate-bg)] px-3.5 py-2.5 text-sm font-medium text-[var(--chip-negotiate)]"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="break-words">{blockedReason}</span>
        </div>
      ) : null}

      {assignments.length > 0 ? (
        <div className="mt-4 min-w-0 space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">
              Active grouping rules ({assignments.length})
            </h4>
            <p className="text-xs text-muted-foreground">
              Composition changes apply before Analyze; re-import if you want to
              change groups later.
            </p>
          </div>

          <ul className="min-w-0 space-y-2.5">
            {assignments.map((assignment) => {
              const report = reportById.get(assignment.groupId);
              const meta = getStatusMeta(report);
              const modeLabel = assignment.mode === "split" ? "Split" : "Merge";
              const groupTitle = assignment.name
                ? assignment.name
                : `${modeLabel} group`;
              const producedExpenses = (report?.expenseIds ?? [])
                .map((id) => expenseById.get(id))
                .filter((e): e is Expense => e !== undefined);

              return (
                <li
                  key={assignment.groupId}
                  className="min-w-0 rounded-lg border border-border bg-muted/30 p-3.5"
                >
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-card px-2 py-0.5 text-xs font-semibold text-foreground">
                          {modeLabel}
                        </span>
                        <span className="min-w-0 max-w-full text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                          {groupTitle}
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                            meta.badgeClass,
                          )}
                        >
                          {report?.status === "applied" && !meta.isNoExpense ? (
                            <CheckCircle2
                              aria-hidden="true"
                              className="h-3 w-3"
                            />
                          ) : null}
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-2 min-w-0 space-y-1 text-xs text-muted-foreground">
                        <p className="break-words">
                          <span className="font-medium text-foreground">
                            Active rows ({report?.activeRawIndices.length ?? 0}
                            ):
                          </span>{" "}
                          {report && report.activeRawIndices.length > 0
                            ? report.activeRawIndices
                                .map(formatLineLabel)
                                .join(", ")
                            : "None"}
                        </p>

                        {report && report.ignoredRawIndices.length > 0 ? (
                          <p className="break-words">
                            <span className="font-medium text-foreground">
                              Ignored rows ({report.ignoredRawIndices.length}):
                            </span>{" "}
                            {report.ignoredRawIndices
                              .map(
                                (item) =>
                                  `${formatLineLabel(item.rawIndex)} (${formatIgnoredReason(item.reason, previewByRawIdx.get(item.rawIndex))})`,
                              )
                              .join(", ")}
                          </p>
                        ) : null}

                        {producedExpenses.length > 0 ? (
                          <p className="min-w-0 text-foreground [overflow-wrap:anywhere]">
                            <span className="font-medium">
                              Resulting expenses:
                            </span>{" "}
                            {producedExpenses
                              .map(
                                (exp) =>
                                  `${exp.merchant} (${formatUsd(exp.priceCents)}/${FREQUENCY_SHORT[exp.frequency]})`,
                              )
                              .join(" · ")}
                          </p>
                        ) : null}

                        {meta.isNoExpense ? (
                          <p className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground">
                            Selected rows did not form a recurring expense. They
                            stay out of automatic detection while this group is
                            active; undo grouping to return them to automatic
                            detection.
                          </p>
                        ) : null}

                        {report?.status === "inactive" ? (
                          <p className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground">
                            This group is inactive (not applied) because fewer
                            than 2 active rows remain. Any remaining eligible
                            row goes back to automatic detection.
                          </p>
                        ) : null}

                        {report && report.issues.length > 0 ? (
                          <ul className="space-y-1 pt-0.5">
                            {report.issues.map((issue, idx) => (
                              <li
                                key={`${issue.code}-${idx}`}
                                className={cn(
                                  "flex items-start gap-1.5 break-words text-xs",
                                  issue.severity === "error"
                                    ? "font-medium text-[var(--chip-cut)]"
                                    : issue.severity === "warning"
                                      ? "font-medium text-[var(--chip-negotiate)]"
                                      : "text-muted-foreground",
                                )}
                              >
                                <AlertTriangle
                                  aria-hidden="true"
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                />
                                <span>{issue.message}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {report?.status === "needs_confirmation" &&
                      report.proposal ? (
                        <button
                          type="button"
                          onClick={() => onRequestConfirm(assignment.groupId)}
                          className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
                        >
                          Review &amp; confirm
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => onUndoGroup(assignment.groupId)}
                        aria-label={`Undo grouping for ${groupTitle} (${assignment.groupId})`}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
                        Undo grouping
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
