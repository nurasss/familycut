import type { ActionStatus, Confidence, Decision, Frequency } from "@/lib/types";

const MAX_CENTS = 100_000_000;
const MAX_DOLLARS = 1_000_000;

/**
 * Parse a user-entered USD string like "$15.49" or "1,234.50" into exact integer cents.
 * Returns null if the input is empty, invalid, negative, or exceeds $1,000,000.
 */
export function parsePriceInputToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, wholeStr, fracStr = ""] = match;
  const whole = Number.parseInt(wholeStr, 10);
  if (!Number.isSafeInteger(whole) || whole < 0 || whole > MAX_DOLLARS) {
    return null;
  }

  const fracCents = Number.parseInt(fracStr.padEnd(2, "0"), 10);
  const cents = whole * 100 + fracCents;
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

export function centsToInputValue(cents: number | undefined): string {
  if (cents === undefined || !Number.isFinite(cents)) return "";
  const wholeCents = Math.trunc(cents);
  const sign = wholeCents < 0 ? "-" : "";
  const abs = Math.abs(wholeCents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${dollars}.${String(rem).padStart(2, "0")}`;
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
