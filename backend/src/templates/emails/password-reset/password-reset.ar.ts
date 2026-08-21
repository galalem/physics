import { button } from '../register';

export const subject = 'إعادة تعيين كلمة المرور — Φysics';

export const text = ({ link }: { link: string }) =>
  `تم طلب إعادة تعيين كلمة المرور لحسابك على Φysics.

اتبع الرابط لتعيين كلمة مرور جديدة:
${link}

ينتهي هذا الرابط خلال ساعة واحدة. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">إعادة تعيين كلمة المرور</h1>
<p style="margin:0 0 24px;">تم طلب إعادة تعيين كلمة المرور لحسابك على Φysics. اتبع الرابط لتعيين كلمة مرور جديدة.</p>
<p style="margin:0 0 24px;">${button(link, 'إعادة تعيين كلمة المرور')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">ينتهي هذا الرابط خلال ساعة واحدة. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.</p>`;
