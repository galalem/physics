import { button } from '../register';

export const subject = 'Reset your password — Φysics';

export const text = ({ link }: { link: string }) =>
  `A password reset was requested for your Φysics account.

Follow the link to set a new password:
${link}

This link expires in 1 hour. If you didn't request this, you can safely ignore this email.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Reset your password</h1>
<p style="margin:0 0 24px;">A password reset was requested for your Φysics account. Follow the link to set a new password.</p>
<p style="margin:0 0 24px;">${button(link, 'Reset password')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`;
