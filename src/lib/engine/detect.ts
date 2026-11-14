import type { Expense, Transaction } from '@/lib/types';

/** Find recurring expenses in normalized transactions (TZ §7.3). */
export function detectRecurring(txs: Transaction[]): Expense[] {
  void txs;
  throw new Error('not implemented');
}
