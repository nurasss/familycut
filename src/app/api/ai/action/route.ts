import { NextResponse } from 'next/server';
import { fallbackAction } from '@/lib/ai/fallback';
import { generateWithGrok } from '@/lib/ai/grok';
import { checkRateLimit, clientIp } from '@/lib/ai/rateLimit';
import { actionRequestSchema } from '@/lib/schemas';

// Request bodies are tiny; reject anything large before parsing.
const MAX_BODY_CHARS = 2000;

export async function POST(request: Request) {
  const limit = checkRateLimit(clientIp(request.headers));
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  let json: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = actionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Only the validated ActionRequest fields reach the model. No content is logged.
  const ai = await generateWithGrok(parsed.data);
  return NextResponse.json(ai ?? fallbackAction(parsed.data), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
