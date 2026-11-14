// Tiny in-memory sliding-window rate limiter (per server instance). Good enough for the demo;
// replace with a shared store (Redis/Upstash) if the app runs on several instances.
const hits = new Map<string, number[]>();

export const RATE_LIMIT = 20;
export const WINDOW_MS = 60_000;

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);

  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return { ok: true };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test helper. */
export function resetRateLimit(): void {
  hits.clear();
}
