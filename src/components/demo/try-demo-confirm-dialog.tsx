"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";

export type TryDemoConfirmDialogProps = {
  open: boolean;
  existingExpenseCount: number;
  hasGoal: boolean;
  hasReportedSavings: boolean;
  onCancel: () => void;
  onConfirm: () => void;
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

export function TryDemoConfirmDialog({
  open,
  existingExpenseCount,
  hasGoal,
  hasReportedSavings,
  onCancel,
  onConfirm,
}: TryDemoConfirmDialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const restoreFocusOnCloseRef = useRef(false);
  const backdropDownRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
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
  }, [open]);

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
        if (val !== "sync" && open) {
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
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(94vw,30rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-lg sm:p-6"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--chip-negotiate)]"
        />
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold text-foreground">
            Replace your current saved audit with demo data?
          </h2>
          <p
            id={descId}
            className="mt-2 text-sm leading-relaxed text-muted-foreground"
          >
            Loading the sample demo audit will overwrite your existing audit
            data in this browser:
          </p>
        </div>
      </div>

      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground">
        {existingExpenseCount > 0 ? (
          <>
            <li>
              Saved expenses ({existingExpenseCount}) and all Keep / Cut /
              Negotiate decisions
            </li>
            <li>
              Action checklist progress and self-reported savings
              {hasReportedSavings ? " (currently saved)" : ""}
            </li>
          </>
        ) : null}
        <li>Your family savings goal{hasGoal ? " (currently set)" : ""}</li>
        {existingExpenseCount > 0 ? (
          <li>
            Existing action page links from your previous audit will stop
            working
          </li>
        ) : null}
      </ul>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Choose Cancel to keep your current audit, goal, and any unsaved input on
        this page.
      </p>

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
            onConfirm();
          }}
          className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg bg-[var(--chip-cut)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
        >
          Replace with demo
        </button>
      </div>
    </dialog>
  );
}
