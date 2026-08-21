import { button } from '../register';

export const subject = 'Verify your email — Φysics';

export const text = ({ link }: { link: string }) =>
  `Welcome to Φysics.

Confirm your email to activate your account:
${link}

This link expires in 24 hours.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Welcome to Φysics</h1>
<p style="margin:0 0 24px;">Confirm your email to activate your account.</p>
<p style="margin:0 0 24px;">${button(link, 'Verify email')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">This link expires in 24 hours.</p>`;
