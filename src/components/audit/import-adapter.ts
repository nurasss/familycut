import {
  analyzeTransactions,
  pickReviewCandidates,
} from "@/lib/engine/detect";
import type {
  ExpenseSource,
  GroupAssignment,
  GroupReport,
} from "@/lib/engine/grouping";
import {
  GENERATED_ID_PREFIX,
  MAX_FILE_BYTES,
  applyMapping,
  parseCsv,
  parsePaste,
  rowLine,
  suggestMapping,
} from "@/lib/engine/parse";
import type {
  ColumnMapping,
  Expense,
  RawRow,
  Transaction,
} from "@/lib/types";

export { MAX_FILE_BYTES };

export type RowPreviewStatus =
  | "valid"
  | "error"
  | "refund"
  | "duplicate"
  | "credit"
  | "skipped";

export type RowPreviewItem = {
  rawIndex: number;
  lineNumber: number;
  raw: RawRow;
  status: RowPreviewStatus;
  reason?: string;
  transaction?: Transaction;
  expenseId?: string;
  groupId?: string;
};

export type ParseRowsResult =
  | {
      ok: true;
      rows: RawRow[];
      headers: string[];
      mapping: ColumnMapping;
      mappingAutoDetected: boolean;
    }
  | {
      ok: false;
      error: string;
      isNotImplemented: boolean;
    };

export type EvaluateRowsResult =
  | {
      ok: true;
      previews: RowPreviewItem[];
      expenses: Expense[];
      sources: ExpenseSource[];
      groupReports: GroupReport[];
      validCount: number;
      attentionCount: number;
      excludedCount: number;
    }
  | {
      ok: false;
      error: string;
      isNotImplemented: boolean;
    };

function isNotImplementedError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.toLowerCase().includes("not implemented")
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Could not process these transactions. Please check your formatting and try again.";
}

export function fallbackColumnMapping(headers: string[]): ColumnMapping {
  const date = headers[0] ?? "Date";
  const description = headers[1] ?? headers[0] ?? "Description";
  const amount = headers[2] ?? headers[1] ?? headers[0] ?? "Amount";
  return {
    date,
    description,
    amount,
    signConvention: "negative_is_debit",
  };
}

export function parseInputRows(
  mode: "csv" | "paste",
  text: string,
): ParseRowsResult {
  try {
    const rows = mode === "csv" ? parseCsv(text) : parsePaste(text);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const suggested = headers.length > 0 ? suggestMapping(headers) : null;
    const mapping = suggested ?? fallbackColumnMapping(headers);
    return {
      ok: true,
      rows,
      headers,
      mapping,
      mappingAutoDetected: suggested !== null,
    };
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
      isNotImplemented: isNotImplementedError(err),
    };
  }
}

export function evaluateMappedRows(
  rawRows: RawRow[],
  mapping: ColumnMapping,
  overrides: Record<number, RawRow>,
  skippedIndices: Set<number>,
  groups?: readonly GroupAssignment[],
): EvaluateRowsResult {
  try {
    const activeIndices: number[] = [];
    const effectiveRows: RawRow[] = [];

    rawRows.forEach((row, idx) => {
      if (!skippedIndices.has(idx)) {
        activeIndices.push(idx);
        effectiveRows.push(overrides[idx] ?? row);
      }
    });

    const parseResult = applyMapping(effectiveRows, mapping);
    const errorByEffectiveIdx = new Map<number, string>();
    for (const err of parseResult.errors) {
      const effIdx = err.index;
      if (effIdx >= 0 && effIdx < activeIndices.length) {
        errorByEffectiveIdx.set(effIdx, err.reason);
      }
    }

    const seenKeys = new Set<string>();
    let txCursor = 0;
    const transactionsWithSource: Transaction[] = [];
    const activePreviewByIdx = new Map<number, RowPreviewItem>();

    activeIndices.forEach((rawIdx, effIdx) => {
      const raw = effectiveRows[effIdx];
      const errReason = errorByEffectiveIdx.get(effIdx);
      if (errReason) {
        activePreviewByIdx.set(rawIdx, {
          rawIndex: rawIdx,
          lineNumber: rowLine(rawRows[rawIdx], rawIdx),
          raw,
          status: "error",
          reason: errReason,
        });
        return;
      }

      const tx = parseResult.rows[txCursor++];
      if (!tx) {
        activePreviewByIdx.set(rawIdx, {
          rawIndex: rawIdx,
          lineNumber: rowLine(rawRows[rawIdx], rawIdx),
          raw,
          status: "error",
          reason: "Could not parse row",
        });
        return;
      }

      const txWithSource: Transaction = { ...tx, sourceIndex: rawIdx };
      transactionsWithSource.push(txWithSource);

      let status: RowPreviewStatus = "valid";
      let reason: string | undefined;

      const hasRealId = !tx.id.startsWith(GENERATED_ID_PREFIX);
      if (hasRealId) {
        const key = [tx.date, tx.merchantNormalized, tx.amountCents, tx.id].join(
          "|",
        );
        if (seenKeys.has(key)) {
          status = "duplicate";
          reason = "Duplicate — excluded";
        } else {
          seenKeys.add(key);
        }
      }

      if (status === "valid" && tx.isRefund) {
        status = "refund";
        reason = "Refund — excluded";
      } else if (status === "valid" && tx.amountCents < 0) {
        status = "credit";
        reason = "Incoming credit — excluded";
      }

      activePreviewByIdx.set(rawIdx, {
        rawIndex: rawIdx,
        lineNumber: rowLine(rawRows[rawIdx], rawIdx),
        raw,
        status,
        reason,
        transaction: txWithSource,
      });
    });

    const { expenses, sources, groups: groupReports } = analyzeTransactions(
      transactionsWithSource,
      groups !== undefined ? { groups } : undefined,
    );

    const expenseIdByRawIndex = new Map<number, string>();
    for (const src of sources) {
      for (const idx of src.sourceIndices) {
        expenseIdByRawIndex.set(idx, src.expenseId);
      }
    }

    const groupIdByRawIndex = new Map<number, string>();
    for (const report of groupReports) {
      for (const idx of report.activeRawIndices) {
        groupIdByRawIndex.set(idx, report.groupId);
      }
    }

    const previews: RowPreviewItem[] = rawRows.map((raw, rawIdx) => {
      if (skippedIndices.has(rawIdx)) {
        return {
          rawIndex: rawIdx,
          lineNumber: rowLine(rawRows[rawIdx], rawIdx),
          raw: overrides[rawIdx] ?? raw,
          status: "skipped",
          reason: "Skipped — excluded",
        };
      }
      const base = activePreviewByIdx.get(rawIdx) ?? {
        rawIndex: rawIdx,
        lineNumber: rowLine(rawRows[rawIdx], rawIdx),
        raw,
        status: "error" as const,
        reason: "Could not parse row",
      };
      const expenseId = expenseIdByRawIndex.get(rawIdx);
      const groupId = groupIdByRawIndex.get(rawIdx);
      return {
        ...base,
        ...(expenseId !== undefined ? { expenseId } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
      };
    });

    let validCount = 0;
    let attentionCount = 0;
    let excludedCount = 0;

    for (const p of previews) {
      if (p.status === "valid") validCount++;
      else if (p.status === "error") attentionCount++;
      else excludedCount++;
    }

    return {
      ok: true,
      previews,
      expenses,
      sources,
      groupReports,
      validCount,
      attentionCount,
      excludedCount,
    };
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
      isNotImplemented: isNotImplementedError(err),
    };
  }
}

export function getReviewCandidates(
  expenses: Expense[],
  limit = 3,
): Expense[] {
  return pickReviewCandidates(expenses, limit);
}
