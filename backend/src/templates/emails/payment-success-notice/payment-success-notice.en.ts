import { button } from '../register';

interface Args {
  days: number;
  validUntil: Date;
  link: string;
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);

export const subject = 'Payment received — Φysics';

export const text = ({ days, validUntil, link }: Args) =>
  `Thanks — your payment went through and your access to Φysics is now active.

Your access is valid for ${days} days, until ${fmt(validUntil)}.

Head over to the catalog whenever you're ready: ${link}`;

export const html = ({ days, validUntil, link }: Args) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Payment received</h1>
<p style="margin:0 0 16px;">Thanks — your payment went through and your access to Φysics is now active.</p>
<p style="margin:0 0 24px;">Your access is valid for <strong>${days} days</strong>, until <strong>${fmt(validUntil)}</strong>.</p>
<p style="margin:0 0 8px;">${button(link, 'Open Φysics')}</p>`;
