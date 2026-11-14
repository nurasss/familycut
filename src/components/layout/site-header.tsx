"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuditStore } from "@/lib/store";
import { useHasHydrated } from "@/components/use-hydrated";
import { SampleDataBadge } from "@/components/ui-badges";
import { cn } from "@/lib/utils";

const STEPS = [
  { step: 1, label: "Add expenses", href: "/audit" },
  { step: 2, label: "Review", href: "/results" },
  { step: 3, label: "Act", href: "/action" },
] as const;

type SiteHeaderProps = {
  variant?: "landing" | "app";
  currentStep?: 1 | 2 | 3;
};

export function SiteHeader({
  variant = "app",
  currentStep,
}: SiteHeaderProps) {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const loadDemo = useAuditStore((s) => s.loadDemo);
  const isDemo = useAuditStore((s) => s.isDemo);

  const handleTryDemo = () => {
    loadDemo();
    router.push("/results");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xs">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-2 text-foreground no-underline"
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" aria-hidden="true" />
          </span>
          <span className="font-[family-name:var(--font-heading)] text-lg font-bold tracking-tight text-foreground">
            FamilyCut
          </span>
        </Link>

        {variant === "landing" ? (
          <nav
            aria-label="Primary"
            className="no-print flex items-center gap-2 sm:gap-4"
          >
            <a
              href="#how-it-works"
              className="hidden min-h-11 items-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              How it works
            </a>
            <button
              type="button"
              onClick={handleTryDemo}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Try demo
            </button>
          </nav>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2">
            {hydrated && isDemo && (
              <SampleDataBadge className="px-2 py-0.5 text-[11px] sm:px-2.5 sm:text-xs" />
            )}
            <button
              type="button"
              onClick={handleTryDemo}
              className="no-print inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:px-3.5 sm:text-sm"
            >
              Try demo
            </button>
          </div>
        )}
      </div>

      {variant === "app" && currentStep && (
        <div className="no-print border-t border-border/80 bg-background/80">
          <nav
            aria-label="Audit progress"
            className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6"
          >
            <ol className="flex w-full items-center gap-1.5 sm:gap-3">
              {STEPS.map((item, idx) => {
                const isCurrent = item.step === currentStep;
                const isDone = item.step < currentStep;
                return (
                  <li
                    key={item.step}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 sm:flex-initial",
                    )}
                  >
                    <Link
                      href={item.href}
                      aria-current={isCurrent ? "step" : undefined}
                      className={cn(
                        "relative flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:w-auto sm:px-3 sm:text-sm",
                        isCurrent
                          ? "bg-card text-foreground font-semibold border border-border"
                          : isDone
                            ? "text-primary hover:bg-card/60"
                            : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                          isCurrent
                            ? "bg-primary text-primary-foreground"
                            : isDone
                              ? "bg-[var(--savings-bg)] text-primary"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {item.step}
                      </span>
                      <span className="truncate">{item.label}</span>
                      {isCurrent && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
                        />
                      )}
                    </Link>
                    {idx < STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="hidden text-muted-foreground/50 sm:inline"
                      >
                        /
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      )}
    </header>
  );
}
