const BASE = process.env.MAILPIT_URL || 'http://localhost:8025'

export interface MailSummary {
  ID: string
  Subject: string
  From: { Name: string; Address: string }
  To: { Name: string; Address: string }[]
  Created: string
}

export interface MailDetail extends MailSummary {
  Text: string
  HTML: string
}

export async function purge(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/messages`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Mailpit purge failed: HTTP ${res.status}`)
}

export async function list(limit = 5): Promise<MailSummary[]> {
  const res = await fetch(`${BASE}/api/v1/messages?limit=${limit}`)
  if (!res.ok) throw new Error(`Mailpit list failed: HTTP ${res.status}`)
  const data = (await res.json()) as { messages: MailSummary[] }
  return data.messages
}

export async function latest(): Promise<MailDetail | null> {
  const [summary] = await list(1)
  if (!summary) return null
  const res = await fetch(`${BASE}/api/v1/message/${summary.ID}`)
  if (!res.ok) throw new Error(`Mailpit get failed: HTTP ${res.status}`)
  return (await res.json()) as MailDetail
}

// Wait for a mail matching a predicate (default: any mail to the given
// address). Polls Mailpit every 200ms up to timeoutMs. Returns the first
// match, or throws.
export async function waitFor(
  predicate: (mail: MailSummary) => boolean,
  timeoutMs = 5000,
): Promise<MailDetail> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = await list(10)
    const match = messages.find(predicate)
    if (match) {
      const detail = await fetch(`${BASE}/api/v1/message/${match.ID}`)
      return (await detail.json()) as MailDetail
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Mail matching predicate never arrived within ${timeoutMs}ms`)
}

export async function waitForRecipient(email: string, timeoutMs = 5000): Promise<MailDetail> {
  return waitFor((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()), timeoutMs)
}

// Pulls a `?token=...` param out of the mail's text body. Verify + reset
// links both use this shape.
export function extractLinkToken(mail: MailDetail, param = 'token'): string {
  const re = new RegExp(`${param}=([A-Za-z0-9\\-_]+)`)
  const match = mail.Text.match(re)
  if (!match) throw new Error(`No ${param}= found in mail body`)
  return match[1]
}

// Pulls the first http(s) link out of the mail's text body.
export function extractLink(mail: MailDetail): string {
  const match = mail.Text.match(/https?:\/\/\S+/)
  if (!match) throw new Error('No link found in mail body')
  return match[0]
}

// CLI: `pnpm tsx helpers/mailpit.ts <purge|latest|list>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2]
  const run = async () => {
    if (cmd === 'purge') {
      await purge()
      console.log('Mailpit inbox purged.')
      return
    }
    if (cmd === 'latest') {
      const mail = await latest()
      if (!mail) return console.log('(no mail)')
      console.log(`From:    ${mail.From.Name} <${mail.From.Address}>`)
      console.log(`To:      ${mail.To.map((t) => t.Address).join(', ')}`)
      console.log(`Subject: ${mail.Subject}`)
      const link = mail.Text.match(/https?:\/\/\S+/)
      if (link) console.log(`Link:    ${link[0]}`)
      return
    }
    if (cmd === 'list') {
      const messages = await list(10)
      for (const m of messages) {
        console.log(`${m.Created}  ${m.To[0]?.Address ?? '?'}  ${m.Subject}`)
      }
      return
    }
    console.error('Usage: tsx helpers/mailpit.ts <purge|latest|list>')
    process.exit(2)
  }
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
