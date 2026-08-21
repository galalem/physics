import { type Locale, requireEnv } from '~/config';

export interface Template {
  subject: string;
  text: (args?: any) => string;
  html: (args?: any) => string;
}

const store: Record<string, Record<Locale, Template>> = {};

export const register = (key: string, template: Record<Locale, Template>) => (store[key] = template);

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function render(key: string, locale: Locale, args?: any): RenderedEmail {
  const t = store[key]?.[locale];
  if (!t) throw new Error(`no email template registered for '${key}' (${locale})`);
  return {
    subject: t.subject,
    text: t.text(args),
    html: layout(locale, t.subject, t.html(args)),
  };
}

// Button helper for template HTML slots. Inline styles for email-client compat.
export function button(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}" style="display:inline-block;background:#F97316;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-family:'Space Grotesk',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;">${escapeText(label)}</a>`;
}

const FONT_STACK = `'Space Grotesk',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;

const POWERED_BY: Record<Locale, string> = {
  en: 'Powered by Galalem Holding',
  fr: 'Propulsé par Galalem Holding',
  ar: 'بدعم من Galalem Holding',
};

function layout(locale: Locale, title: string, bodyHtml: string): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const logoUrl = `${requireEnv('PUBLIC_BASE_URL').replace(/\/$/, '')}/brand/logo-email.png`;
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeText(title)}</title>
</head>
<body style="margin:0;padding:0;background:#EFEDE7;font-family:${FONT_STACK};color:#16151C;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
<div style="text-align:center;padding:8px 0 24px;"><img src="${escapeAttr(logoUrl)}" alt="Φysics" width="92" height="40" style="display:inline-block;border:0;outline:none;text-decoration:none;"></div>
<div style="background:#ffffff;border-radius:8px;padding:32px;border:1px solid #E2DFD4;line-height:1.5;">
${bodyHtml}
</div>
<div style="text-align:center;color:#8a8579;font-size:12px;padding:16px 0;">${escapeText(POWERED_BY[locale])}</div>
</div>
</body>
</html>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
