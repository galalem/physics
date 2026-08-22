import { button } from '../register';

interface Args {
  days: number;
  validUntil: Date;
  link: string;
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('fr', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);

export const subject = 'Paiement reçu — Φysics';

export const text = ({ days, validUntil, link }: Args) =>
  `Merci — votre paiement est bien passé et votre accès à Φysics est maintenant actif.

Votre accès est valable ${days} jours, jusqu'au ${fmt(validUntil)}.

Retrouvez le catalogue quand vous voulez : ${link}`;

export const html = ({ days, validUntil, link }: Args) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Paiement reçu</h1>
<p style="margin:0 0 16px;">Merci — votre paiement est bien passé et votre accès à Φysics est maintenant actif.</p>
<p style="margin:0 0 24px;">Votre accès est valable <strong>${days} jours</strong>, jusqu'au <strong>${fmt(validUntil)}</strong>.</p>
<p style="margin:0 0 8px;">${button(link, 'Ouvrir Φysics')}</p>`;
