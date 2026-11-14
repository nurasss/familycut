import { z } from 'zod';

export const frequencySchema = z.enum(['weekly', 'monthly', 'quarterly', 'yearly', 'unknown']);

const MAX_CENTS = 100_000_000; // $1,000,000 sanity cap

export const actionRequestSchema = z.object({
  merchant: z.string().trim().min(1).max(80),
  action: z.enum(['cut', 'negotiate']),
  frequency: frequencySchema,
  currentPriceCents: z.number().int().min(0).max(MAX_CENTS),
  targetPriceCents: z.number().int().min(0).max(MAX_CENTS).optional(),
  tone: z.enum(['polite', 'firm']),
});

export const actionResponseSchema = z.object({
  subject: z.string().max(200).nullable(),
  body: z.string().max(4000).nullable(),
  callScript: z.string().max(4000).nullable(),
  steps: z.array(z.string().max(300)).max(10),
  limitations: z.array(z.string().max(300)).max(10),
  source: z.enum(['ai', 'fallback']),
});
