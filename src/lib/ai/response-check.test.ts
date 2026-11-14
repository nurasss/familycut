// Regression tests for F11 (strict validation of model answers) and the F12 refinements of the local fallback.
// Mocked fetch and synthetic data only; no real LLM calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/ai/action/route';
import type { ActionRequest, ActionResponse } from '@/lib/types';
import { fallbackAction } from './fallback';
import { generateWithGrok, parseModelOutput } from './grok';
import { resetRateLimit } from './rateLimit';
import { containsUnverifiedContact, validateModelAnswer } from './response-check';

const NEGOTIATE: ActionRequest = { merchant: 'Netflix', action: 'negotiate', frequency: 'monthly', currentPriceCents: 7500, targetPriceCents: 6000, tone: 'polite' };
const NEGOTIATE_NO_TARGET: ActionRequest = { ...NEGOTIATE, targetPriceCents: undefined };
const CUT: ActionRequest = { ...NEGOTIATE, action: 'cut', targetPriceCents: undefined };

const SCRIPT = [
  'Hi, I am reviewing my Netflix bill. I currently pay $75.00 per month.',
  'Could you bring it down to $60.00?',
  'Please confirm the new price, all fees, and how long the offer lasts before I agree.',
].join('\n');

const negotiateAnswer = (over: Record<string, unknown> = {}) => ({
  subject: '',
  body: '',
  callScript: SCRIPT,
  steps: ['Check your bill', 'Ask about current offers', 'Confirm the terms'],
  limitations: ['You must contact the provider yourself.', 'Results are not guaranteed.'],
  ...over,
});
const cutAnswer = (over: Record<string, unknown> = {}) => ({
  subject: 'Cancellation request: Netflix',
  body: 'Hello, I would like to cancel my Netflix subscription. Please confirm the effective date and any remaining charges. Thank you, [Your name]',
  callScript: '',
  steps: ['Open the support chat', 'Ask for written confirmation'],
  limitations: ['You must contact the provider yourself.', 'Results are not guaranteed.'],
  ...over,
});
const accept = (a: unknown, req = NEGOTIATE) => validateModelAnswer(a, req);

describe('F11 structure is checked before anything is normalised', () => {
  it('valid answers are accepted and tagged ai; empty irrelevant fields become null', () => {
    expect(accept(negotiateAnswer())).toMatchObject({ source: 'ai', subject: null, body: null, callScript: SCRIPT });
    expect(accept(cutAnswer(), CUT)).toMatchObject({ source: 'ai', callScript: null });
    expect(accept(cutAnswer({ subject: '' }), CUT)).toMatchObject({ subject: null });
  });

  it('steps=42 and limitations="invalid" are rejected (not turned into empty arrays)', () => {
    expect(accept(negotiateAnswer({ steps: 42 }))).toBeNull();
    expect(accept(negotiateAnswer({ limitations: 'invalid' }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: 42, limitations: 'invalid' }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: 'x' }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: ['ok', 5] }))).toBeNull();
    expect(accept(negotiateAnswer({ limitations: [null] }))).toBeNull();
  });

  it('missing keys, wrong types, arrays and non-objects are rejected', () => {
    for (const k of ['subject', 'body', 'callScript', 'steps', 'limitations']) {
      const a = negotiateAnswer() as Record<string, unknown>;
      delete a[k];
      expect(accept(a), k).toBeNull();
    }
    expect(accept(negotiateAnswer({ subject: null }))).toBeNull();
    expect(accept(negotiateAnswer({ callScript: 5 }))).toBeNull();
    for (const v of [null, 'text', 42, [], true]) expect(accept(v)).toBeNull();
  });

  it('steps and limitations must be useful: non-empty, no blank entries, bounded', () => {
    expect(accept(negotiateAnswer({ steps: [] }))).toBeNull();
    expect(accept(negotiateAnswer({ limitations: [] }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: ['ok', '  '] }))).toBeNull();
    expect(accept(negotiateAnswer({ limitations: [''] }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: Array.from({ length: 7 }, (_, i) => `Step ${i}`) }))).toBeNull();
    expect(accept(negotiateAnswer({ limitations: Array.from({ length: 6 }, (_, i) => `Note ${i}`) }))).toBeNull();
    expect(accept(negotiateAnswer({ steps: ['x'.repeat(301)] }))).toBeNull();
  });

  it('Cut needs a body; Negotiate needs a callScript; fields of the other action must stay empty', () => {
    expect(accept(cutAnswer({ body: '' }), CUT)).toBeNull();
    expect(accept(cutAnswer({ body: '   ' }), CUT)).toBeNull();
    expect(accept(cutAnswer({ callScript: SCRIPT }), CUT)).toBeNull();
    expect(accept(negotiateAnswer({ callScript: '' }))).toBeNull();
    expect(accept(negotiateAnswer({ body: 'An email body' }))).toBeNull();
    expect(accept(negotiateAnswer({ subject: 'A subject' }))).toBeNull();
    expect(accept(negotiateAnswer(), CUT)).toBeNull(); // a negotiation answer to a cancellation request
  });

  it('a negotiation script has 3 to 6 non-empty lines', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} about my plan.`).join('\n');
    for (const n of [0, 1, 2, 7, 12]) expect(accept(negotiateAnswer({ callScript: lines(n) })), `${n}`).toBeNull();
    for (const n of [3, 4, 5, 6]) expect(accept(negotiateAnswer({ callScript: lines(n) })), `${n}`).not.toBeNull();
    // blank lines do not count as lines, \r\n is fine
    expect(accept(negotiateAnswer({ callScript: 'A one.\n\n\nB two.\r\n\r\nC three.' }))).not.toBeNull();
    expect(accept(negotiateAnswer({ callScript: 'A one.\n\n\nB two.' }))).toBeNull();
  });

  it('parseModelOutput: bad JSON, non-string content and the structure errors all return null', () => {
    expect(parseModelOutput(JSON.stringify(negotiateAnswer()), NEGOTIATE)).toMatchObject({ source: 'ai' });
    expect(parseModelOutput('not json', NEGOTIATE)).toBeNull();
    expect(parseModelOutput(undefined, NEGOTIATE)).toBeNull();
    expect(parseModelOutput(JSON.stringify(negotiateAnswer({ steps: 42, limitations: 'invalid' })), NEGOTIATE)).toBeNull();
  });
});

describe('F11 unverified contacts are rejected; amounts and placeholders are not contacts', () => {
  const withText = (t: string) => negotiateAnswer({ steps: [t] });

  it.each([
    'Go to https://netflix.com/cancel',
    'Visit www.netflix.com',
    'Open netflix.com/help and chat',
    'See help.example.org for details',
    'Email support@netflix.com',
    'write to a.b+c@example.co.uk',
    'Call 1-800-555-0100',
    'Call (555) 010-0199 today',
    'Call 555-010-0199',
    'Call +1 555 010 0199',
    'Call 555.010.0199',
    'Call 5550100199',
    'Call 1-800-NETFLIX',
    'Dial 555-0199',
  ])('rejects: %s', (t) => {
    expect(containsUnverifiedContact(t), t).toBe(true);
    expect(accept(withText(t)), t).toBeNull();
    for (const field of ['callScript', 'limitations'] as const) {
      const a = negotiateAnswer(field === 'callScript' ? { callScript: `${SCRIPT}\n${t}`.split('\n').slice(0, 4).join('\n') } : { limitations: [t] });
      expect(accept(a), `${field}: ${t}`).toBeNull();
    }
    expect(accept(cutAnswer({ body: `Hello. ${t}` }), CUT), 'cut body').toBeNull();
  });

  it.each([
    'I currently pay $75.00 per month.',
    'I pay $75 and would like $60.00.',
    'The price is $1,000,000.00 in a test.',
    'Ask for written confirmation by 2026-12-01.',
    'My billing date is 10/12/2026.',
    'Use the placeholders [Account email], [Billing date], [Customer service channel] and [Your name].',
    'Sign it [Your name].',
    'Reference 12345678 only.',
    'Wait 30 days, then 90 days later check again.',
    'Ask about e.g. loyalty plans, i.e. discounts.',
  ])('accepts: %s', (t) => {
    expect(containsUnverifiedContact(t), t).toBe(false);
  });

  it('a normal answer with prices, a date and placeholders passes the whole validation', () => {
    const a = negotiateAnswer({
      callScript: 'Hi, my [Account email] is on a $75.00 plan.\nCould you offer $60.00 from [Billing date]?\nPlease confirm the new price, fees and terms before I agree.',
      steps: ['Use the [Customer service channel]', 'Check by 2026-12-01'],
    });
    expect(accept(a)).toMatchObject({ source: 'ai' });
  });

  it('prices other than the current and target price are rejected (no invented savings or competitor offers)', () => {
    expect(accept(withText('You will save $180 per year.'))).toBeNull();
    expect(accept(withText('A competitor charges $50.00.'))).toBeNull();
    expect(accept(withText('I pay $74.99.'))).toBeNull();
    // without a target no target / savings amount may be mentioned
    expect(accept(negotiateAnswer({ steps: ['Ask for $60.00'] }), NEGOTIATE_NO_TARGET)).toBeNull();
    const noTargetScript = 'Hi, I pay $75.00 per month.\nAre there cheaper plans?\nPlease confirm the price, fees and terms first.';
    expect(accept(negotiateAnswer({ callScript: noTargetScript, steps: ['Current price is $75.00'] }), NEGOTIATE_NO_TARGET)).not.toBeNull();
  });

  it('an unfilled [Service] placeholder is rejected', () => {
    expect(accept(withText('Contact [Service] support'))).toBeNull();
  });
});

describe('W3B1 bracketed text does not hide contacts; ordinary domains are recognised', () => {
  const BRACKETED = ['Visit [https://evil.com]', 'Email [support@evil.com]', 'Call [1-800-555-0100]', 'Open [www.evil.com]', 'Go to [evil.com/cancel]', 'Text [(555) 010-0199]'];
  const DOMAINS = [
    'Visit support.example.co.uk',
    'Visit cancel.example.xyz',
    'Visit example.ru/help',
    'Visit EXAMPLE.RU',
    'Visit shop.example.it/cancel',
    'See a.b.example.org.',
    'Open netflix.com',
  ];

  it.each([...BRACKETED, ...DOMAINS])('predicate rejects: %s', (t) => {
    expect(containsUnverifiedContact(t), t).toBe(true);
  });

  it('only the four agreed placeholders are exempt (any case); other brackets are scanned', () => {
    for (const ph of ['[Account email]', '[Billing date]', '[Customer service channel]', '[Your name]', '[your NAME]']) {
      expect(containsUnverifiedContact(`Please use ${ph}.`), ph).toBe(false);
    }
    expect(containsUnverifiedContact('[Account email] [Billing date] [Customer service channel] [Your name]')).toBe(false);
    expect(containsUnverifiedContact('[Account email: support@evil.com]')).toBe(true);
    expect(containsUnverifiedContact('[Your name] or [https://evil.com]')).toBe(true);
    // a bracket that is not a contact and not an agreed placeholder is simply text
    expect(containsUnverifiedContact('[Something else]')).toBe(false);
  });

  it.each([
    'Add e.g. loyalty plans, i.e. discounts.',
    'Inc. and Co. LLC are fine',
    'I pay $75.00 or $1,000.00 in a test',
    'By 2026-12-01 or 10/12/2026 or 12.10.2026',
    'Version v2.0, 3.5% off, approx. 30 days',
    'U.S. only, St. Louis, and/or both',
    'The bill.It is due soon',
    'Sign [Your name].',
  ])('predicate accepts: %s', (t) => {
    expect(containsUnverifiedContact(t), t).toBe(false);
  });

  const placeIn = (text: string) => ({
    cutBody: cutAnswer({ body: `Hello. ${text} Thank you.` }),
    cutSubject: cutAnswer({ subject: text }),
    cutStep: cutAnswer({ steps: [text] }),
    cutLimitation: cutAnswer({ limitations: [text] }),
    scriptLine: negotiateAnswer({ callScript: `Hi, I pay $75.00.\n${text}\nPlease confirm the price and terms.` }),
    negStep: negotiateAnswer({ steps: ['Check your bill', text] }),
    negLimitation: negotiateAnswer({ limitations: ['You must contact the provider yourself.', text] }),
  });

  it.each([...BRACKETED, ...DOMAINS])('validateModelAnswer rejects "%s" in every field of both actions', (t) => {
    const a = placeIn(t);
    for (const [name, ans] of Object.entries(a)) {
      const req = name.startsWith('cut') ? CUT : NEGOTIATE;
      expect(validateModelAnswer(ans, req), `${name}: ${t}`).toBeNull();
    }
  });

  it('the same fields accept harmless text with amounts, dates, e.g./i.e. and the agreed placeholders', () => {
    const t = 'Use the [Customer service channel] with [Account email] by 2026-12-01 (e.g. chat, i.e. not phone) and sign [Your name].';
    for (const [name, ans] of Object.entries(placeIn(t))) {
      const req = name.startsWith('cut') ? CUT : NEGOTIATE;
      expect(validateModelAnswer(ans, req), name).not.toBeNull();
    }
  });
});

describe('generateWithGrok retries once on a structurally invalid answer, then falls back', () => {
  beforeEach(() => {
    vi.stubEnv('XAI_API_KEY', 'test-key');
    vi.stubEnv('XAI_MODEL', '');
    resetRateLimit();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 });
  const bad = () => reply(negotiateAnswer({ steps: 42, limitations: 'invalid' }));

  it('steps=42 / limitations="invalid" -> retry -> valid second answer is used', async () => {
    const f = vi.fn().mockImplementationOnce(async () => bad()).mockImplementationOnce(async () => reply(negotiateAnswer()));
    vi.stubGlobal('fetch', f);
    const out = await generateWithGrok(NEGOTIATE);
    expect(out).toMatchObject({ source: 'ai', callScript: SCRIPT });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('invalid twice -> null (route falls back); exactly one retry', async () => {
    const f = vi.fn().mockImplementation(async () => bad());
    vi.stubGlobal('fetch', f);
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('an answer with an invented phone number is retried and then dropped', async () => {
    const withPhone = negotiateAnswer({ steps: ['Call 1-800-555-0100'] });
    const f = vi.fn().mockImplementation(async () => reply(withPhone));
    vi.stubGlobal('fetch', f);
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('the shared 8 s deadline still applies to both attempts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))),
    );
    const p = generateWithGrok(NEGOTIATE);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('W3B1: a bracketed contact is retried once, then dropped; a clean second answer is accepted', async () => {
    const hidden = cutAnswer({ body: 'Hello, please cancel. Visit [https://evil.com] for details.' });
    const f = vi.fn().mockImplementation(async () => reply(hidden));
    vi.stubGlobal('fetch', f);
    expect(await generateWithGrok(CUT)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn().mockImplementationOnce(async () => reply(negotiateAnswer({ steps: ['Visit support.example.co.uk'] }))).mockImplementationOnce(async () => reply(negotiateAnswer()));
    vi.stubGlobal('fetch', g);
    expect(await generateWithGrok(NEGOTIATE)).toMatchObject({ source: 'ai', callScript: SCRIPT });
    expect(g).toHaveBeenCalledTimes(2);
  });

  it('W3B1 route: contacts hidden in brackets or on ordinary domains -> HTTP 200 with the local fallback', async () => {
    for (const [i, bad] of [negotiateAnswer({ limitations: ['Call [1-800-555-0100]'] }), negotiateAnswer({ steps: ['Visit example.ru/help'] })].entries()) {
      const f = vi.fn().mockImplementation(async () => reply(bad));
      vi.stubGlobal('fetch', f);
      const res = await POST(
        new Request('http://localhost/api/ai/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${10 + i}` },
          body: JSON.stringify(NEGOTIATE),
        }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as ActionResponse).source).toBe('fallback');
      expect(f).toHaveBeenCalledTimes(2);
    }
  });

  it('route: structurally invalid answers twice -> HTTP 200 with the local fallback; safe merchant policy intact', async () => {
    const f = vi.fn().mockImplementation(async () => bad());
    vi.stubGlobal('fetch', f);
    const res = await POST(
      new Request('http://localhost/api/ai/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ ...NEGOTIATE, merchant: 'John Smith john.smith@example.com' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse;
    expect(body.source).toBe('fallback');
    expect(body.callScript!.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [, init] of f.mock.calls) expect(String(init.body)).not.toMatch(/John|Smith|example\.com/);
  });
});

describe('F12 local fallback', () => {
  const lines = (r: ActionRequest) => fallbackAction(r).callScript!.split('\n').filter(Boolean);

  it('Negotiate is 3 to 6 short lines for both tones, with and without a target', () => {
    for (const tone of ['polite', 'firm'] as const) {
      for (const req of [NEGOTIATE, NEGOTIATE_NO_TARGET]) {
        const l = lines({ ...req, tone });
        expect(l.length).toBeGreaterThanOrEqual(3);
        expect(l.length).toBeLessThanOrEqual(6);
        expect(l.every((x) => x.length <= 300)).toBe(true);
      }
    }
  });

  it('asks to confirm the new price, fees, how long the offer lasts, and the contract terms before agreeing', () => {
    const text = lines(NEGOTIATE).join(' ').toLowerCase();
    expect(text).toContain('new price');
    expect(text).toMatch(/\bfee/);
    expect(text).toMatch(/how long/);
    expect(text).toMatch(/contract terms/);
    expect(text).toMatch(/before i agree/);
  });

  it('uses the given prices only: target when present, nothing invented when absent', () => {
    expect(lines(NEGOTIATE).join('\n')).toContain('$75.00');
    expect(lines(NEGOTIATE).join('\n')).toContain('$60.00');
    const none = lines(NEGOTIATE_NO_TARGET).join('\n');
    expect(none).toContain('$75.00');
    expect(none).not.toMatch(/\$60|bring (it|this) down|sav|\d+%/i);
    expect(none.match(/\$\d[\d,]*(?:\.\d{2})?/g)).toEqual(['$75.00']);
  });

  it('tone changes wording, not facts', () => {
    const polite = lines(NEGOTIATE).join('\n');
    const firm = lines({ ...NEGOTIATE, tone: 'firm' }).join('\n');
    expect(firm).not.toBe(polite);
    expect(firm).toContain('$75.00');
    expect(firm).toContain('$60.00');
  });

  it('Firm Cut asks for cancellation and a confirmed date; it never claims a right to immediate termination', () => {
    for (const tone of ['polite', 'firm'] as const) {
      const body = fallbackAction({ ...CUT, tone }).body!;
      expect(body).not.toMatch(/immediate/i);
      expect(body).not.toMatch(/\b(entitled|right to|legally|must refund)\b/i);
      expect(body).toMatch(/confirm/i);
      expect(body).toMatch(/cancellation date|date the cancellation takes effect/i);
      expect(body).toContain('Netflix');
    }
    expect(fallbackAction({ ...CUT, tone: 'firm' }).body).not.toBe(fallbackAction(CUT).body);
    expect(fallbackAction({ ...CUT, tone: 'firm' }).body).toMatch(/request/i);
  });

  it('contains no invented contacts, and its own text would pass the AI validator', () => {
    for (const tone of ['polite', 'firm'] as const) {
      for (const req of [NEGOTIATE, NEGOTIATE_NO_TARGET, CUT]) {
        const r = fallbackAction({ ...req, tone });
        const all = [r.subject, r.body, r.callScript, ...r.steps, ...r.limitations].filter(Boolean).join('\n');
        expect(containsUnverifiedContact(all)).toBe(false);
        expect(r.source).toBe('fallback');
        const asModel = { subject: r.subject ?? '', body: r.body ?? '', callScript: r.callScript ?? '', steps: r.steps, limitations: r.limitations };
        expect(validateModelAnswer(asModel, { ...req, tone }), `${tone} ${req.action}`).not.toBeNull();
      }
    }
  });
});
