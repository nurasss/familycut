import { cn } from "@/lib/utils";
import type { ActionStatus, Confidence, Decision } from "@/lib/types";
import {
  ACTION_STATUS_LABEL,
  CONFIDENCE_LABEL,
  DECISION_LABEL,
} from "@/components/money-input";

export function DecisionChip({
  decision,
  className,
}: {
  decision: Decision;
  className?: string;
}) {
  const styles: Record<Decision, string> = {
    keep: "bg-[var(--chip-keep-bg)] text-[var(--chip-keep)] border-transparent",
    cut: "bg-[var(--chip-cut-bg)] text-[var(--chip-cut)] border-transparent",
    negotiate:
      "bg-[var(--chip-negotiate-bg)] text-[var(--chip-negotiate)] border-transparent",
    not_recurring:
      "bg-transparent text-muted-foreground border border-border",
    undecided:
      "bg-muted text-muted-foreground border border-border",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap",
        styles[decision],
        className,
      )}
    >
      {DECISION_LABEL[decision]}
    </span>
  );
}

export function ConfidencePill({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground whitespace-nowrap",
        className,
      )}
    >
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

export function ActionStatusBadge({
  status,
  className,
}: {
  status: ActionStatus;
  className?: string;
}) {
  const styles: Record<ActionStatus, string> = {
    not_started: "bg-muted text-muted-foreground border-border",
    attempted:
      "bg-[var(--chip-negotiate-bg)] text-[var(--chip-negotiate)] border-transparent",
    completed: "bg-[var(--savings-bg)] text-primary border-transparent",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[status],
        className,
      )}
    >
      {ACTION_STATUS_LABEL[status]}
    </span>
  );
}

export function SampleDataBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase whitespace-nowrap",
        className,
      )}
    >
      Sample data
    </span>
  );
}
