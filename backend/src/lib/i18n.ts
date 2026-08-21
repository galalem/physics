import { type Locale, LOCALE_FALLBACK } from '~/config';

// Pick the best available value from a per-locale map, following the
// LOCALE_FALLBACK chain. Returns null when no locale in the chain has a value.
export function pickLocale<T>(byLocale: Map<Locale, T> | undefined, preferred: Locale): T | null {
  if (!byLocale) return null;
  const chain: Locale[] = [preferred, ...LOCALE_FALLBACK.filter((l) => l !== preferred)];
  for (const l of chain) {
    const v = byLocale.get(l);
    if (v !== undefined) return v;
  }
  return null;
}

export interface TranslationRow {
  record_type: 'tag' | 'exercise';
  record_id: string;
  locale: Locale;
  field: string;
  value: string;
}

// Groups translations by record + field, so callers can pickLocale() cheaply.
// Key: `${record_id}:${field}` → Map<Locale, value>.
export function indexTranslations(rows: TranslationRow[]): Map<string, Map<Locale, string>> {
  const out = new Map<string, Map<Locale, string>>();
  for (const r of rows) {
    const key = `${r.record_id}:${r.field}`;
    let inner = out.get(key);
    if (!inner) {
      inner = new Map();
      out.set(key, inner);
    }
    inner.set(r.locale, r.value);
  }
  return out;
}
