import { describe, expect, it } from "vitest";
import {
  centsToInputValue,
  parsePriceInputToCents,
} from "@/components/money-input";

describe("parsePriceInputToCents", () => {
  it("parses exact integer cents without float rounding errors", () => {
    const floatProneCases: [string, number][] = [
      ["0.01", 1],
      ["0.07", 7],
      ["0.14", 14],
      ["0.29", 29],
      ["0.57", 57],
      ["1.13", 113],
      ["2.34", 234],
      ["8.95", 895],
      ["18.89", 1889],
      ["19.99", 1999],
      ["35.85", 3585],
      ["268.34", 26834],
      ["999999.99", 99_999_999],
    ];

    for (const [input, expected] of floatProneCases) {
      expect(parsePriceInputToCents(input)).toBe(expected);
      expect(Number.isInteger(parsePriceInputToCents(input))).toBe(true);
    }
  });

  it("preserves all currently accepted USD formats", () => {
    expect(parsePriceInputToCents("0")).toBe(0);
    expect(parsePriceInputToCents("0.0")).toBe(0);
    expect(parsePriceInputToCents("0.00")).toBe(0);
    expect(parsePriceInputToCents("0.")).toBe(0);
    expect(parsePriceInputToCents("15")).toBe(1500);
    expect(parsePriceInputToCents("15.")).toBe(1500);
    expect(parsePriceInputToCents("15.4")).toBe(1540);
    expect(parsePriceInputToCents("15.40")).toBe(1540);
    expect(parsePriceInputToCents("15.49")).toBe(1549);
    expect(parsePriceInputToCents("$15.49")).toBe(1549);
    expect(parsePriceInputToCents("$ 15.49")).toBe(1549);
    expect(parsePriceInputToCents("  $1,234.50  ")).toBe(123_450);
    expect(parsePriceInputToCents("0015.05")).toBe(1505);
  });

  it("enforces the $1,000,000 cap (100,000,000 cents)", () => {
    expect(parsePriceInputToCents("1000000")).toBe(100_000_000);
    expect(parsePriceInputToCents("1000000.00")).toBe(100_000_000);
    expect(parsePriceInputToCents("$1,000,000.00")).toBe(100_000_000);
    expect(parsePriceInputToCents("1000000.0")).toBe(100_000_000);
    expect(parsePriceInputToCents("1000000.")).toBe(100_000_000);

    expect(parsePriceInputToCents("1000000.01")).toBeNull();
    expect(parsePriceInputToCents("1000001")).toBeNull();
    expect(parsePriceInputToCents("$1,000,000.01")).toBeNull();
    expect(parsePriceInputToCents("999999999999999999999999")).toBeNull();
  });

  it("rejects empty, negative, over-precision, and malformed inputs", () => {
    const invalidInputs = [
      "",
      "   ",
      "$",
      ",",
      ".",
      ".50",
      "15.499",
      "15.000",
      "-15.49",
      "+15.49",
      "15..00",
      "15.4.0",
      "15.4a",
      "abc",
      "1e5",
      "Infinity",
      "NaN",
    ];

    for (const bad of invalidInputs) {
      expect(parsePriceInputToCents(bad), `input: ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe("centsToInputValue", () => {
  it("formats cents into fixed two-decimal strings without float errors", () => {
    expect(centsToInputValue(undefined)).toBe("");
    expect(centsToInputValue(Number.NaN)).toBe("");
    expect(centsToInputValue(0)).toBe("0.00");
    expect(centsToInputValue(5)).toBe("0.05");
    expect(centsToInputValue(50)).toBe("0.50");
    expect(centsToInputValue(1500)).toBe("15.00");
    expect(centsToInputValue(1999)).toBe("19.99");
    expect(centsToInputValue(100_000_000)).toBe("1000000.00");
  });

  it("round-trips exact cents cleanly across edge ranges", () => {
    for (let c = 0; c <= 500; c += 1) {
      expect(parsePriceInputToCents(centsToInputValue(c))).toBe(c);
    }
    for (const c of [
      1889,
      1999,
      9999,
      123456,
      99_999_999,
      100_000_000,
    ]) {
      expect(parsePriceInputToCents(centsToInputValue(c))).toBe(c);
    }
  });
});
