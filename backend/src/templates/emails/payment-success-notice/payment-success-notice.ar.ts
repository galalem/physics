import { button } from '../register';

interface Args {
  days: number;
  validUntil: Date;
  link: string;
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);

export const subject = 'تم استلام الدفعة — Φysics';

export const text = ({ days, validUntil, link }: Args) =>
  `شكرًا — تم تأكيد الدفع وأصبح وصولك إلى Φysics فعّالًا الآن.

مدة صلاحية اشتراكك ${days} يومًا، حتى ${fmt(validUntil)}.

افتح الكتالوج وابدأ باللعب متى شئت: ${link}`;

export const html = ({ days, validUntil, link }: Args) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">تم استلام الدفعة</h1>
<p style="margin:0 0 16px;">شكرًا — تم تأكيد الدفع وأصبح وصولك إلى Φysics فعّالًا الآن.</p>
<p style="margin:0 0 24px;">مدة صلاحية اشتراكك <strong>${days} يومًا</strong>، حتى <strong>${fmt(validUntil)}</strong>.</p>
<p style="margin:0 0 8px;">${button(link, 'افتح Φysics')}</p>`;
