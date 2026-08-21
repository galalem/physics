import { button } from '../register';

export const subject = 'تأكيد بريدك الإلكتروني — Φysics';

export const text = ({ link }: { link: string }) =>
  `مرحبًا بك في Φysics.

يرجى تأكيد بريدك الإلكتروني لتفعيل حسابك:
${link}

ينتهي هذا الرابط خلال 24 ساعة.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">مرحبًا بك في Φysics</h1>
<p style="margin:0 0 24px;">يرجى تأكيد بريدك الإلكتروني لتفعيل حسابك.</p>
<p style="margin:0 0 24px;">${button(link, 'تأكيد البريد الإلكتروني')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">ينتهي هذا الرابط خلال 24 ساعة.</p>`;
