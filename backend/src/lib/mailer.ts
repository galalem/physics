import { createTransport, type Transporter } from 'nodemailer';
import { requireEnv } from '~/config';

// SMTP dispatch seam. Provider choice is a config concern: SMTP_URL is a
// standard `smtp[s]://user:pass@host:port` URL. Dev uses Mailpit at
// `smtp://localhost:1025`; prod uses whatever relay the operator picks.

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) transporter = createTransport(requireEnv('SMTP_URL'));
  return transporter;
}

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(payload: MailPayload): Promise<void> {
  await getTransporter().sendMail({
    ...payload,
    from: requireEnv('MAIL_FROM'),
  });
}
