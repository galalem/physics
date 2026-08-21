import { button } from '../register';

export const subject = 'Réinitialisez votre mot de passe — Φysics';

export const text = ({ link }: { link: string }) =>
  `Une réinitialisation de mot de passe a été demandée pour votre compte Φysics.

Cliquez sur le lien pour définir un nouveau mot de passe :
${link}

Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.`;

export const html = ({ link }: { link: string }) =>
  `<h1 style="margin:0 0 16px;font-size:20px;">Réinitialisez votre mot de passe</h1>
<p style="margin:0 0 24px;">Une réinitialisation de mot de passe a été demandée pour votre compte Φysics. Cliquez sur le lien pour définir un nouveau mot de passe.</p>
<p style="margin:0 0 24px;">${button(link, 'Réinitialiser le mot de passe')}</p>
<p style="margin:0;color:#57606a;font-size:13px;">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>`;
