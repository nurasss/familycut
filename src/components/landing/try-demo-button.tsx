"use client";

import { useRouter } from "next/navigation";
import { useAuditStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function TryDemoButton({
  className,
  children = "Try demo",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const loadDemo = useAuditStore((s) => s.loadDemo);

  return (
    <button
      type="button"
      onClick={() => {
        loadDemo();
        router.push("/results");
      }}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}
