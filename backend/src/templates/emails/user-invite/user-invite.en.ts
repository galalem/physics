import { button } from '../register';

export const subject = 'You have been invited to Φysics';

export const text = ({ link, firstName }: { link: string; firstName: string }) =>
  `Hi ${firstName},

An account has been created for you on Φysics.

Follow the link to choose your password and activate it:
${link}

This link expires in 7 days. Until you use it, the account cannot be signed into.`;

export const html = ({ link, firstName }: { link: string; firstName: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">You have been invited to &#934;ysics</h1>
<p style="margin:0 0 24px;">Hi ${firstName}, an account has been created for you. Choose a password to activate it.</p>
<p style="margin:0 0 24px;">${button(link, 'Set your password')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">This link expires in 7 days. Until you use it, the account cannot be signed into.</p>`;
