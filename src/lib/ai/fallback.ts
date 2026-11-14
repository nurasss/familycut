import { formatUsd } from '@/lib/format';
import type { ActionRequest, ActionResponse } from '@/lib/types';

/** Local templates, TZ §10.4. No LLM involved. */
export function fallbackAction(req: ActionRequest): ActionResponse {
  const service = req.merchant;
  if (req.action === 'cut') {
    return {
      subject: `Cancellation request: ${service}`,
      body: `Hello, I would like to cancel my ${service} subscription. Please confirm the effective cancellation date and any remaining charges. Thank you.`,
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
  return {
    subject: null,
    body: null,
    callScript: `Hi, I’m reviewing my monthly bill for ${service}. I currently pay ${formatUsd(req.currentPriceCents)}. Are there lower-cost plans or loyalty offers available? Please confirm all fees and the new price before making changes.`,
    steps: ['Check your bill', 'Ask about current offers', 'Confirm terms'],
    limitations: ['You must contact the provider yourself.', 'Offers are not guaranteed.'],
    source: 'fallback',
  };
}
