import { formatUsd } from '@/lib/format';
import type { ActionRequest, ActionResponse, Frequency } from '@/lib/types';

const PERIOD: Record<Frequency, string> = {
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'annual',
  unknown: 'recurring',
};

/**
 * Local templates (TZ §10.4). No LLM involved; tone changes wording, never facts. No phone numbers, URLs or
 * e-mail addresses, no promised savings, no claimed rights: the user asks and the provider answers.
 */
export function fallbackAction(req: ActionRequest): ActionResponse {
  const service = req.merchant;
  const firm = req.tone === 'firm';

  if (req.action === 'cut') {
    return {
      subject: `Cancellation request: ${service}`,
      body: firm
        ? `Hello, I am requesting to cancel my ${service} subscription as soon as your terms allow. Please confirm in writing the date the cancellation takes effect and any remaining charges. Please do not bill me again after that date. Thank you.`
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
  const lines = [
    `Hi, I’m reviewing my ${period} ${service} bill. I currently pay ${price}.`,
    req.targetPriceCents !== undefined
      ? `Is there a plan or loyalty offer that could bring it down to ${formatUsd(req.targetPriceCents)}?`
      : 'Are there any lower-cost plans or loyalty offers I’m eligible for?',
    'Before I agree to anything, please confirm the new price and every fee or tax in writing.',
    'Please also tell me how long the offer lasts and what happens to the price afterwards.',
    'And please confirm the contract terms, such as any commitment period or cancellation fee.',
    firm
      ? 'If there is no better option, I will consider other providers.'
      : 'Thank you. I’ll decide once I have those details.',
  ];

  return {
    subject: null,
    body: null,
    callScript: lines.join('\n'),
    steps: ['Check your bill', 'Ask about current offers', 'Confirm price, fees, duration and terms before agreeing'],
    limitations: ['You must contact the provider yourself.', 'Offers are not guaranteed.'],
    source: 'fallback',
  };
}
