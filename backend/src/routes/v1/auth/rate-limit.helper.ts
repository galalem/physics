import type { Context } from 'hono';

// In-memory fixed-window rate limiter. Single-instance only — the backend
// runs as one container, no shared state needed. If we ever scale out
// horizontally, swap to Redis (or accept per-instance drift for these
// coarse anti-abuse caps).

type LimitResult = { ok: true } | { ok: false; retryAfter: number };

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Peek at the current bucket state without mutating. Used when a caller
// wants to reject early without also counting the current request (login
// counts only *failed* attempts, so it peeks first, then records on
// failure).
export function peekLimit(key: string, max: number, _windowMs: number): LimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return { ok: true };
  if (bucket.count >= max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

// Increment the bucket for `key`, creating (or resetting after window) as
// needed. No cap enforcement — call peekLimit first if you want to reject
// before recording.
export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    bucket.count++;
  }
}

// Combined "check the cap and consume the slot" — the usual pattern for
// endpoints where every request counts (verify-email/resend, password-reset).
export function rateLimit(key: string, max: number, windowMs: number): LimitResult {
  const result = peekLimit(key, max, windowMs);
  if (result.ok) recordAttempt(key, windowMs);
  return result;
}

// Standard caps for token-mint endpoints (verify-email/resend, password-reset).
// Per-IP is enforced in-memory here; per-account caps live in the
// per-flow helpers (email-changes.helper, password-reset-tokens.helper).
export const MINT_IP_LIMIT_MAX = 20;
export const MINT_EMAIL_LIMIT_MAX = 3;
export const MINT_WINDOW_MS = 60 * 60 * 1000;

// Login per-IP cap: 60 failed / hour / IP. Applied via peek+record so
// successful logins don't burn the quota.
export const LOGIN_IP_LIMIT_MAX = 60;
export const LOGIN_WINDOW_MS = 60 * 60 * 1000;

// Per-account lockout after too many consecutive bad-password attempts.
// Shared across every password endpoint — failed attempts on login,
// password change, delete, and personal-data all count toward the same lock.
export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Best-effort client IP resolution. Trusts `X-Forwarded-For` when present
// (nginx sets it in prod); falls back to the raw node socket. Returns
// 'unknown' if neither is available — same key = single shared bucket,
// which errs on the side of rate-limiting more aggressively.
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}
