"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type {
  GroupAssignment,
  GroupProposal,
  GroupReport,
} from "@/lib/engine/grouping";
import { formatUsd } from "@/lib/format";
import type { ColumnMapping } from "@/lib/types";
import type { RowPreviewItem } from "@/components/audit/import-adapter";
import { FREQUENCY_LABEL, FREQUENCY_SHORT } from "@/components/money-input";

type GroupConfirmDialogProps = {
  open: boolean;
  groupId: string | null;
  assignment: GroupAssignment | null;
  report: GroupReport | null;
  previews: readonly RowPreviewItem[];
  mapping: ColumnMapping;
  onConfirm: (groupId: string, proposal: GroupProposal) => void;
  onCancel: () => void;
};

function isPointerOutsideElement(
  event: React.PointerEvent<HTMLDialogElement>,
  el: HTMLDialogElement,
): boolean {
  const rect = el.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

export function GroupConfirmDialog({
  open,
  groupId,
  assignment,
  report,
  previews,
  mapping,
  onConfirm,
  onCancel,
}: GroupConfirmDialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const restoreFocusOnCloseRef = useRef(false);
  const backdropDownRef = useRef(false);

  const proposal =
    report?.status === "needs_confirmation" ? report.proposal : undefined;
  const shouldBeOpen = Boolean(open && groupId && proposal);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (shouldBeOpen) {
      if (!wasOpenRef.current) {
        openerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      wasOpenRef.current = true;
      restoreFocusOnCloseRef.current = true;
      if (!dialog.open) {
        dialog.returnValue = "";
        dialog.showModal();
      }
      cancelBtnRef.current?.focus();
    } else {
      if (dialog.open) {
        dialog.returnValue = "sync";
        dialog.close("sync");
      }
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const shouldRestore = restoreFocusOnCloseRef.current;
        restoreFocusOnCloseRef.current = false;
        const opener = openerRef.current;
        openerRef.current = null;
        if (shouldRestore && opener && opener.isConnected) {
          opener.focus();
        }
      }
    }
  }, [shouldBeOpen, proposal?.proposalKey]);

  const previewByRawIdx = new Map<number, RowPreviewItem>();
  for (const item of previews) {
    previewByRawIdx.set(item.rawIndex, item);
  }

  const activeRows = (report?.activeRawIndices ?? [])
    .map((idx) => previewByRawIdx.get(idx))
    .filter((item): item is RowPreviewItem => item !== undefined);

  const handleCancelClick = () => {
    restoreFocusOnCloseRef.current = true;
    onCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        handleCancelClick();
      }}
      onClose={() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const val = dialog.returnValue;
        dialog.returnValue = "";
        if (val !== "sync" && shouldBeOpen) {
          handleCancelClick();
        }
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        backdropDownRef.current =
          e.target === dialog && isPointerOutsideElement(e, dialog);
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const wasOutsideDown = backdropDownRef.current;
        backdropDownRef.current = false;
        if (
          dialog.open &&
          wasOutsideDown &&
          e.target === dialog &&
          isPointerOutsideElement(e, dialog)
        ) {
          handleCancelClick();
        }
      }}
      className="m-auto w-[min(94vw,34rem)] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-5 text-foreground shadow-lg sm:p-6"
    >
      {proposal && groupId ? (
        <div>
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--chip-negotiate)]"
            />
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-bold text-foreground">
                Confirm price change before merging
              </h2>
              <p
                id={descId}
                className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
              >
                The charges you selected include a price jump greater than 1.5x,
                which could mean a different plan or separate service rather
                than a price change on the same subscription. Review the
                resulting service and source charges before applying this merge.
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-sm">
            <div className="col-span-2 min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">
                Service
              </dt>
              <dd className="mt-0.5 min-w-0 font-semibold text-foreground [overflow-wrap:anywhere]">
                {proposal.merchant}
                {assignment?.name ? " (custom name)" : ""}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Latest price
              </dt>
              <dd className="mt-0.5 font-semibold text-foreground tabular-nums">
                {proposal.frequency === "unknown"
                  ? formatUsd(proposal.priceCents)
                  : `${formatUsd(proposal.priceCents)}/${FREQUENCY_SHORT[proposal.frequency]}`}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Frequency &amp; annual total
              </dt>
              <dd className="mt-0.5 font-semibold text-foreground tabular-nums">
                {FREQUENCY_LABEL[proposal.frequency]} ·{" "}
                {proposal.frequency === "unknown"
                  ? "Annual unknown"
                  : `${formatUsd(proposal.annualCents)}/yr`}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Charges &amp; parts
              </dt>
              <dd className="mt-0.5 text-foreground tabular-nums">
                {proposal.chargeCount} charges across {proposal.partCount} parts
              </dd>
            </div>

            {proposal.gapDays.length > 0 ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Gap between parts
                </dt>
                <dd className="mt-0.5 text-foreground tabular-nums">
                  {proposal.gapDays.map((d) => `${d} days`).join(", ")}
                </dd>
              </div>
            ) : null}
          </dl>

          {activeRows.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Selected source charges ({activeRows.length})
              </h3>
              <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2.5 text-xs">
                {activeRows.map((item) => (
                  <li
                    key={item.rawIndex}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5 last:border-b-0 last:pb-0"
                  >
                    <span className="min-w-0 break-words text-foreground">
                      <span className="font-semibold">
                        Line {item.lineNumber}
                      </span>
                      {" · "}
                      <span className="tabular-nums">
                        {item.transaction?.date ?? item.raw[mapping.date] ?? ""}
                      </span>
                      {" · "}
                      {item.transaction?.merchantRaw ??
                        item.raw[mapping.description] ??
                        ""}
                    </span>
                    <span className="shrink-0 font-semibold text-foreground tabular-nums">
                      {item.transaction
                        ? formatUsd(item.transaction.amountCents)
                        : item.raw[mapping.amount] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              ref={cancelBtnRef}
              type="button"
              autoFocus
              onClick={handleCancelClick}
              className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                restoreFocusOnCloseRef.current = false;
                onConfirm(groupId, proposal);
              }}
              className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95 sm:w-auto"
            >
              Confirm merge
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
