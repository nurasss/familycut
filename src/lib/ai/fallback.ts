import { formatUsd } from '@/lib/format';
import type { ActionRequest, ActionResponse, Frequency } from '@/lib/types';

const PERIOD: Record<Frequency, string> = {
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'annual',
  unknown: 'recurring',
};

/** Local templates (TZ §10.4). No LLM involved; tone changes wording, never facts. */
export function fallbackAction(req: ActionRequest): ActionResponse {
  const service = req.merchant;
  const firm = req.tone === 'firm';

  if (req.action === 'cut') {
    return {
      subject: `Cancellation request: ${service}`,
      body: firm
        ? `Hello, I am cancelling my ${service} subscription effective immediately. Please confirm the cancellation date in writing and list any remaining charges. Please do not bill me again after that date. Thank you.`
        : `Hello, I would like to cancel my ${service} subscription. Please confirm the effective cancellation date and any remaining charges. Thank you.`,
      callScript: null,
      steps: [
        'Find your account email and billing date',
        'Send the message through the provider’s support channel',
        'Ask for written confirmation of the cancellation date',
      ],
      limitations: [
        'You must contact the provider yourself.',
        'Check the provider’s terms for fees and refunds.',
      ],
      source: 'fallback',
    };
  }

  const period = PERIOD[req.frequency];
  const price = formatUsd(req.currentPriceCents);
  const hasTarget = req.targetPriceCents !== undefined;
  const ask = hasTarget
    ? `I’d like to bring this down to ${formatUsd(req.targetPriceCents!)}. `
    : '';
  const script = firm
    ? `Hi, I’m reviewing my ${period} bill for ${service}. I currently pay ${price}. ${ask}I’m prepared to switch providers if I can’t get a better rate, so please tell me what lower-cost plans or loyalty offers are available. Please confirm all fees and the new price before making any changes.`
    : `Hi, I’m reviewing my ${period} bill for ${service}. I currently pay ${price}. ${ask}Are there lower-cost plans or loyalty offers available? Please confirm all fees and the new price before making changes.`;

  return {
    subject: null,
    body: null,
    callScript: script,
    steps: ['Check your bill', 'Ask about current offers', 'Confirm terms'],
    limitations: ['You must contact the provider yourself.', 'Offers are not guaranteed.'],
    source: 'fallback',
  };
}
