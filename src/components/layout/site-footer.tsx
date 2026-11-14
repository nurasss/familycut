"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuditStore } from "@/lib/store";

export function SiteFooter() {
  const router = useRouter();
  const deleteAllData = useAuditStore((s) => s.deleteAllData);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Fallback light dismiss when HTMLDialogElement closedBy is unsupported (e.g. Safari)
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close("cancel");
        }
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      return () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }
  }, []);

  const handleOpenDialog = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.returnValue = "";
    dialog.showModal();
  };

  const handleDialogClose = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const val = dialog.returnValue;
    dialog.returnValue = "";
    if (val === "delete") {
      deleteAllData();
      window.dispatchEvent(new CustomEvent("familycut:delete-all-data"));
      router.push("/");
    }
  };

  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="font-[family-name:var(--font-heading)] text-sm font-bold text-foreground">
            FamilyCut
          </span>
          <span aria-hidden="true" className="hidden text-border sm:inline">
            |
          </span>
          <p className="text-xs leading-5 text-muted-foreground">
            Not financial or legal advice. Review details before acting.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenDialog}
          className="no-print inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-[var(--chip-cut)] underline-offset-4 hover:underline"
        >
          Delete my data
        </button>
      </div>

      {/* Native <dialog> opened via showModal(); closedby="any" with fallback */}
      <dialog
        ref={dialogRef}
        {...({ closedby: "any" } as Record<string, string>)}
        aria-labelledby="delete-data-dialog-title"
        onClose={handleDialogClose}
        className="m-auto w-[min(92vw,26rem)] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-5 text-foreground shadow-lg sm:p-6"
      >
        <h2
          id="delete-data-dialog-title"
          className="text-lg font-bold text-foreground"
        >
          Delete all saved audit data?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This clears your expenses, decisions, action statuses, and family goal
          from this browser&apos;s local storage. This action cannot be undone.
        </p>
        <form
          method="dialog"
          className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        >
          <button
            type="submit"
            value="cancel"
            autoFocus
            className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="submit"
            value="delete"
            className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg bg-[var(--chip-cut)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            Delete my data
          </button>
        </form>
      </dialog>
    </footer>
  );
}
