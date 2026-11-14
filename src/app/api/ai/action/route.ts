import { NextResponse } from 'next/server';
import { fallbackAction } from '@/lib/ai/fallback';
import { actionRequestSchema } from '@/lib/schemas';

// Stage 1: validate input, return fallback template. Grok is wired in the next stage.
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = actionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  return NextResponse.json(fallbackAction(parsed.data));
}
