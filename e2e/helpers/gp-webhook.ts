import { createHmac } from 'node:crypto'

// Fabricates + POSTs a synthetic `checkout.completed` webhook to the
// backend, signed with the same HMAC secret GP uses. Stands in for
// GP-side confirmation UI (which is manual QR / cash only today).

interface FireParams {
  targetUrl: string  // full URL to POST, e.g. `${baseURL}/api/v1/webhooks/galalem-payments`
  secret: string
  sessionId: string
  userId: string
  validityUntil: string
  amountMinor: number
  currency: string
  scopeFilter?: string  // JSON-stringified or literal 'null'
  promoCodeId?: string
}

export async function fireCompletedWebhook(p: FireParams): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = {
    id: `web_e2e_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'checkout.completed',
    created: timestamp,
    livemode: false,
    api_version: 'v1',
    data: {
      object: {
        id: p.sessionId,
        currency: p.currency,
        livemode: false,
        amount_total_minor: p.amountMinor,
        metadata: {
          user_id: p.userId,
          validity_until: p.validityUntil,
          scope_filter: p.scopeFilter ?? 'null',
          ...(p.promoCodeId ? { promo_code_id: p.promoCodeId } : {}),
        },
      },
    },
  }
  const rawBody = JSON.stringify(payload)
  const hmac = createHmac('sha256', p.secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const res = await fetch(p.targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payments-Signature': `t=${timestamp},v1=${hmac}`,
    },
    body: rawBody,
  })
  if (!res.ok) {
    throw new Error(`Synthetic webhook POST failed: HTTP ${res.status} — ${await res.text()}`)
  }
}
