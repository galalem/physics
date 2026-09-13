import { button } from '../register';

export const subject = 'Vous êtes invité·e sur Φysics';

export const text = ({ link, firstName }: { link: string; firstName: string }) =>
  `Bonjour ${firstName},

Un compte a été créé pour vous sur Φysics.

Suivez le lien pour choisir votre mot de passe et l'activer :
${link}

Ce lien expire dans 7 jours. Tant qu'il n'est pas utilisé, le compte ne permet pas de se connecter.`;

export const html = ({ link, firstName }: { link: string; firstName: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Vous &ecirc;tes invit&eacute;&middot;e sur &#934;ysics</h1>
<p style="margin:0 0 24px;">Bonjour ${firstName}, un compte a &eacute;t&eacute; cr&eacute;&eacute; pour vous. Choisissez un mot de passe pour l'activer.</p>
<p style="margin:0 0 24px;">${button(link, 'Choisir mon mot de passe')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">Ce lien expire dans 7 jours. Tant qu'il n'est pas utilis&eacute;, le compte ne permet pas de se connecter.</p>`;
