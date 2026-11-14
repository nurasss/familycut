// SAMPLE DATA — the fictional "Miller family". Not real transactions. TZ §15.1.
import type { Expense, FamilyGoal } from '@/lib/types';

export const SAMPLE_DATA_LABEL = 'Sample data';

const base: Pick<Expense, 'actionStatus' | 'flags'> = {
  actionStatus: 'not_started',
  flags: [],
};

export const DEMO_EXPENSES: Expense[] = [
  {
    ...base,
    id: 'demo-streaming-a',
    merchant: 'Streaming A',
    category: 'Entertainment',
    frequency: 'monthly',
    priceCents: 1549,
    confidence: 'high',
    reasons: ['3 charges of $15.49 at ~30-day intervals', 'Stable price'],
    transactionIds: ['TX-1001', 'TX-1002', 'TX-1003'],
    decision: 'cut',
  },
  {
    ...base,
    id: 'demo-fitness',
    merchant: 'Fitness membership',
    category: 'Health & fitness',
    frequency: 'monthly',
    priceCents: 2999,
    confidence: 'high',
    reasons: ['3 charges of $29.99 at ~30-day intervals', 'Stable price'],
    transactionIds: ['TX-1004', 'TX-1005', 'TX-1006'],
    decision: 'cut',
  },
  {
    ...base,
    id: 'demo-internet',
    merchant: 'Internet Provider',
    category: 'Utilities',
    frequency: 'monthly',
    priceCents: 7500,
    confidence: 'high',
    reasons: ['3 charges of $75.00 at ~30-day intervals', 'Stable price'],
    transactionIds: ['TX-1007', 'TX-1008', 'TX-1009'],
    decision: 'negotiate',
    targetPriceCents: 6000,
    flags: ['review_price'],
  },
  {
    ...base,
    id: 'demo-music',
    merchant: 'Music family plan',
    category: 'Entertainment',
    frequency: 'monthly',
    priceCents: 1699,
    confidence: 'medium',
    reasons: ['3 charges of $16.99 at ~30-day intervals'],
    transactionIds: ['TX-1010', 'TX-1011', 'TX-1012'],
    decision: 'keep',
  },
  {
    ...base,
    id: 'demo-cloud',
    merchant: 'Cloud storage',
    category: 'Software',
    frequency: 'monthly',
    priceCents: 999,
    confidence: 'medium',
    reasons: ['3 charges of $9.99 at ~30-day intervals'],
    transactionIds: ['TX-1013', 'TX-1014', 'TX-1015'],
    decision: 'keep',
  },
];

export const DEMO_GOAL: FamilyGoal = { name: 'Family trip', targetCents: 150000 };

// Negative amounts are debits. Sample data only.
// Contains: noisy merchant names, 1 refund (TX-1016), 1 duplicated row (TX-1005 twice),
// grocery purchases on similar dates, 1 yearly $120 payment, 2 incoming payroll rows.
export const DEMO_TRANSACTIONS_CSV = `Date,Description,Amount,Transaction ID
2026-08-03,NETFLIX.COM 8844,-15.49,TX-1001
2026-08-05,PLANET FITNESS #4521 NY,-29.99,TX-1004
2026-08-12,COMCAST CABLE COMM 800-266-2278,-75.00,TX-1007
2026-08-18,SPOTIFY USA P3A1B2,-16.99,TX-1010
2026-08-22,ICLOUD.COM/BILL CA,-9.99,TX-1013
2026-08-08,WHOLEFDS MKT 10234,-86.12,TX-2001
2026-08-15,WHOLEFDS MKT 10234,-112.40,TX-2002
2026-08-22,TRADER JOES #552,-64.75,TX-2003
2026-08-31,PAYROLL DEPOSIT ACME CORP,3200.00,TX-3001
2026-09-03,NETFLIX.COM 8844,-15.49,TX-1002
2026-09-05,PLANET FITNESS #4521 NY,-29.99,TX-1005
2026-09-05,PLANET FITNESS #4521 NY,-29.99,TX-1005
2026-09-12,COMCAST CABLE COMM 800-266-2278,-75.00,TX-1008
2026-09-12,WHOLEFDS MKT 10234,-95.30,TX-2004
2026-09-14,AAA MEMBERSHIP ANNUAL,-120.00,TX-4001
2026-09-18,SPOTIFY USA P3A1B2,-16.99,TX-1011
2026-09-19,TRADER JOES #552,-71.08,TX-2005
2026-09-22,ICLOUD.COM/BILL CA,-9.99,TX-1014
2026-09-30,PAYROLL DEPOSIT ACME CORP,3200.00,TX-3002
2026-10-03,NETFLIX.COM 8844,-15.49,TX-1003
2026-10-05,PLANET FITNESS #4521 NY,-29.99,TX-1006
2026-10-06,NETFLIX.COM REFUND,15.49,TX-1016
2026-10-10,WHOLEFDS MKT 10234,-103.66,TX-2006
2026-10-12,COMCAST CABLE COMM 800-266-2278,-75.00,TX-1009
2026-10-17,TRADER JOES #552,-58.91,TX-2007
2026-10-18,SPOTIFY USA P3A1B2,-16.99,TX-1012
2026-10-22,ICLOUD.COM/BILL CA,-9.99,TX-1015
2026-10-24,WHOLEFDS MKT 10234,-91.27,TX-2008
`;
