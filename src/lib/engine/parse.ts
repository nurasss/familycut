import type { ColumnMapping, ParseResult, RawRow } from '@/lib/types';

/** Parse CSV text (comma/semicolon/tab, BOM-safe) into raw rows keyed by header. */
export function parseCsv(text: string): RawRow[] {
  void text;
  throw new Error('not implemented');
}

/** Parse pasted CSV-like lines into raw rows. */
export function parsePaste(text: string): RawRow[] {
  void text;
  throw new Error('not implemented');
}

/** Apply user column mapping; bad rows go to errors, never abort the whole import. */
export function applyMapping(rows: RawRow[], mapping: ColumnMapping): ParseResult {
  void rows;
  void mapping;
  throw new Error('not implemented');
}
