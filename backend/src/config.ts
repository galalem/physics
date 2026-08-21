export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Only asserts what the process cannot boot without. Other envs
// (SMTP_URL, MAIL_FROM, PUBLIC_BASE_URL, RUNTIME_SIGNING_SECRET) are read
// lazily by the modules that need them so scripts that don't touch those
// flows (migrate, seed) can run without them.
export const config = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: requireEnv('DATABASE_URL'),
  // Defaults true; set SESSION_COOKIE_SECURE=false for local http dev.
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE !== 'false',
} as const;

// Shared with nginx's `secure_link_module` (mirrored into runtime/container
// via env). Rotating it invalidates every outstanding signed bundle URL —
// mid-attempt users get bumped to a re-fetch on the next asset request.
export const runtimeSigningSecret = () => requireEnv('RUNTIME_SIGNING_SECRET');

export const SUPPORTED_LOCALES = ['ar', 'fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// Fallback order used when a translation is missing.
export const LOCALE_FALLBACK: readonly Locale[] = ['ar', 'fr', 'en'];

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;      // rolling
export const SESSION_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60; // hard cap
