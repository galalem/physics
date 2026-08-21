import type { MiddlewareHandler } from 'hono';
import { type Locale, SUPPORTED_LOCALES } from '~/config';

// Reads Accept-Language, picks the first supported locale, defaults to 'en'.
// Fallback across locales when a translation is missing happens at the data
// layer (see LOCALE_FALLBACK in config).
export const locale: MiddlewareHandler<{ Variables: { locale: Locale } }> = async (c, next) => {
  const header = c.req.header('accept-language') ?? '';
  const requested = header
    .split(',')
    .map((s) => s.trim().split(';')[0]?.split('-')[0]?.toLowerCase())
    .filter((s): s is string => !!s);
  const resolved = requested.find((l): l is Locale => (SUPPORTED_LOCALES as readonly string[]).includes(l)) ?? 'en';
  c.set('locale', resolved);
  await next();
};
