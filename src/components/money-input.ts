import type { ActionStatus, Confidence, Decision, Frequency } from "@/lib/types";

const MAX_CENTS = 100_000_000;

/**
 * Parse a user-entered USD string like "$15.49" or "1,234.50" into integer cents.
 * Returns null if the input is empty or not a valid non-negative USD amount.
 */
export function parsePriceInputToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const cents = Math.round(parsed * 100);
  if (cents > MAX_CENTS) return null;
  return cents;
}

export function centsToInputValue(cents: number | undefined): string {
  if (cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export const FREQUENCY_SHORT: Record<Frequency, string> = {
  weekly: "wk",
  monthly: "mo",
  quarterly: "qtr",
  yearly: "yr",
  unknown: "period",
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  unknown: "Unknown",
};

export const DECISION_LABEL: Record<Decision, string> = {
  undecided: "Undecided",
  keep: "Keep",
  cut: "Cut",
  negotiate: "Negotiate",
  not_recurring: "Not recurring",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  manual: "Manual entry",
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  not_started: "Not started",
  attempted: "Attempted",
  completed: "Completed",
};
