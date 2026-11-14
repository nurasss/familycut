"use client";

import { useTryDemo } from "@/components/demo/use-try-demo";
import { TryDemoConfirmDialog } from "@/components/demo/try-demo-confirm-dialog";
import { cn } from "@/lib/utils";

export function TryDemoButton({
  className,
  children = "Try demo",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { requestTryDemo, dialogProps } = useTryDemo({ redirectTo: "/results" });

  return (
    <>
      <button
        type="button"
        onClick={requestTryDemo}
        className={cn(
          "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted",
          className,
        )}
      >
        {children}
      </button>
      <TryDemoConfirmDialog {...dialogProps} />
    </>
  );
}
