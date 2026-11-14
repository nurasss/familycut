import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRequest } from '@/lib/types';
import { fallbackAction } from './fallback';
import { generateWithGrok, parseModelOutput } from './grok';
import { RATE_LIMIT, checkRateLimit, resetRateLimit } from './rateLimit';

const NEGOTIATE: ActionRequest = {
  merchant: 'Example Internet Provider',
  action: 'negotiate',
  frequency: 'monthly',
  currentPriceCents: 7500,
  targetPriceCents: 6000,
  tone: 'polite',
};
const CUT: ActionRequest = { ...NEGOTIATE, action: 'cut', targetPriceCents: undefined };

const goodScript = JSON.stringify({
  subject: '',
  body: '',
  // 3 lines: negotiation scripts must have 3-6 lines (response-check.ts)
  callScript: 'Hi, I’d like to review my plan.\nCan you confirm the new price and fees?\nPlease also confirm the contract terms.',
  steps: ['Check your bill'],
  limitations: ['You must contact the provider yourself.'],
});

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('fallback (T-10, T-16)', () => {
  it('Cut gives an email, Negotiate gives a script', () => {
    expect(fallbackAction(CUT)).toMatchObject({ source: 'fallback', callScript: null });
    expect(fallbackAction(CUT).body).toContain('Example Internet Provider');
    expect(fallbackAction(NEGOTIATE).callScript).toContain('$75.00');
  });
  it('tone changes the text', () => {
    expect(fallbackAction({ ...CUT, tone: 'firm' }).body).not.toBe(fallbackAction(CUT).body);
    expect(fallbackAction({ ...NEGOTIATE, tone: 'firm' }).callScript).not.toBe(fallbackAction(NEGOTIATE).callScript);
  });
  it('Negotiate without target never mentions a target or savings', () => {
    const s = fallbackAction({ ...NEGOTIATE, targetPriceCents: undefined }).callScript!;
    expect(s).not.toMatch(/bring this down|sav/i);
    expect(s).not.toContain('$60');
  });
});

describe('parseModelOutput', () => {
  it('maps empty strings to null and tags source ai', () => {
    expect(parseModelOutput(goodScript, NEGOTIATE)).toMatchObject({ subject: null, body: null, source: 'ai' });
  });
  it('rejects non-JSON and missing required parts', () => {
    expect(parseModelOutput('not json', NEGOTIATE)).toBeNull();
    expect(parseModelOutput(goodScript, CUT)).toBeNull(); // cut needs a body
    expect(parseModelOutput(JSON.stringify({ steps: 'x' }), NEGOTIATE)).toBeNull();
  });
});

describe('generateWithGrok', () => {
  beforeEach(() => {
    vi.stubEnv('XAI_API_KEY', 'test-key');
    vi.stubEnv('XAI_MODEL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('no key -> null without any network call', async () => {
    vi.stubEnv('XAI_API_KEY', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('sends only ActionRequest fields and a json_schema response format', async () => {
    const f = vi.fn().mockResolvedValue(reply(goodScript));
    vi.stubGlobal('fetch', f);
    const out = await generateWithGrok(NEGOTIATE);
    expect(out?.source).toBe('ai');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.properties.source).toBeUndefined();
    const sent = JSON.stringify(body.messages);
    // A name that is not a known service never reaches the model (safe-request policy, see safe-request.test.ts).
    expect(sent).not.toContain('Example Internet Provider');
    expect(sent).toContain('Service provider');
    expect(sent).toContain('$75.00');
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'response_format', 'temperature']);
  });

  it('invalid JSON -> one retry -> success', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply('oops')).mockResolvedValueOnce(reply(goodScript));
    vi.stubGlobal('fetch', f);
    expect((await generateWithGrok(NEGOTIATE))?.source).toBe('ai');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('invalid twice -> null (route falls back)', async () => {
    const f = vi.fn().mockImplementation(async () => reply('oops'));
    vi.stubGlobal('fetch', f);
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('HTTP error / network error / abort -> null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })));
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await generateWithGrok(NEGOTIATE)).toBeNull();
  });

  it('times out after 8 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))),
      ),
    );
    const p = generateWithGrok(NEGOTIATE);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});

describe('rate limit', () => {
  it('allows 20 per minute per key, then blocks, then recovers', () => {
    resetRateLimit();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(checkRateLimit('1.2.3.4', t0 + i).ok).toBe(true);
    const blocked = checkRateLimit('1.2.3.4', t0 + 100);
    expect(blocked.ok).toBe(false);
    expect(checkRateLimit('5.6.7.8', t0 + 100).ok).toBe(true);
    expect(checkRateLimit('1.2.3.4', t0 + 61_000).ok).toBe(true);
  });
});
