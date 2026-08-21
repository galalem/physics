import { button } from '../register';

export const subject = 'Vérifiez votre email — Φysics';

export const text = ({ link }: { link: string }) =>
  `Bienvenue sur Φysics.

Confirmez votre email pour activer votre compte :
${link}

Ce lien expire dans 24 heures.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Bienvenue sur Φysics</h1>
<p style="margin:0 0 24px;">Confirmez votre email pour activer votre compte.</p>
<p style="margin:0 0 24px;">${button(link, 'Vérifier mon email')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">Ce lien expire dans 24 heures.</p>`;
