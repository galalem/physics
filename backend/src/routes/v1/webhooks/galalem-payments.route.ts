import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { requireEnv } from '~/config';
import { errors } from '~/lib/error';
import { Entitlement } from '~/models/entitlement';

// Public, unauthenticated, HMAC-verified. The SOLE path from a successful
// payment to an `entitlements` row (per D24). Bad signature → 400; every
// other failure mode is logged and returns 200 so GP stops retrying.
//
// Signature header: `X-Payments-Signature: t=<unix>,v1=<hex-hmac>`
// HMAC-SHA256("<t>.<raw-body>", GALALEM_PAYMENTS_WEBHOOK_SECRET).
const REPLAY_WINDOW_SECONDS = 300;

interface WebhookEnvelope {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: WebhookSession };
}

interface WebhookSession {
  id: string;
  amount_total_minor: number;
  currency: string;
  livemode: boolean;
  metadata: Record<string, string> | null;
}

function parseSignatureHeader(header: string | undefined): { t: number; v1: string } | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === 't') {
      const n = Number(v);
      if (Number.isFinite(n)) t = n;
    } else if (k === 'v1') {
      v1 = v;
    }
  }
  return t !== null && v1 !== null ? { t, v1 } : null;
}

function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.t) > REPLAY_WINDOW_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default function registerRoutes(app: Hono): void {
  app.post('/galalem-payments', async (c) => {
    // Read raw body first — signature is over the exact bytes; JSON parsing
    // would re-serialize and break the HMAC.
    const rawBody = await c.req.text();
    if (!verifySignature(rawBody, c.req.header('X-Payments-Signature'), requireEnv('GALALEM_PAYMENTS_WEBHOOK_SECRET'))) {
      throw errors.webhookSignatureInvalid();
    }

    let envelope: WebhookEnvelope;
    try {
      envelope = JSON.parse(rawBody) as WebhookEnvelope;
    } catch {
      console.error('[gp-webhook] body is not valid JSON');
      return c.body(null, 200);
    }

    if (envelope.type !== 'checkout.completed') {
      // canceled / expired / anything else — ack and drop.
      return c.body(null, 200);
    }

    const session = envelope.data?.object;
    const meta = session?.metadata;
    if (!session || !meta) {
      console.error('[gp-webhook] checkout.completed missing session / metadata', {
        event_id: envelope.id,
      });
      return c.body(null, 200);
    }

    const userId = meta['user_id'];
    const validityUntilStr = meta['validity_until'];
    const scopeFilterStr = meta['scope_filter'];
    const promoCodeId = meta['promo_code_id'] ?? null;
    if (!userId || !validityUntilStr) {
      console.error('[gp-webhook] metadata missing user_id / validity_until', { event_id: envelope.id });
      return c.body(null, 200);
    }

    const validUntil = new Date(validityUntilStr);
    if (Number.isNaN(validUntil.getTime())) {
      console.error('[gp-webhook] validity_until is not a valid date', { event_id: envelope.id, validityUntilStr });
      return c.body(null, 200);
    }

    let scopeFilter: { tags?: unknown } | null = null;
    if (scopeFilterStr) {
      try {
        const parsed = JSON.parse(scopeFilterStr);
        scopeFilter = parsed === null ? null : (parsed as { tags?: unknown });
      } catch {
        console.error('[gp-webhook] scope_filter is not valid JSON', { event_id: envelope.id });
        return c.body(null, 200);
      }
    }

    try {
      const id = await Entitlement.insertPurchase({
        userId,
        validUntil,
        scopeFilter,
        promoCodeId,
        paymentSessionId: session.id,
        paymentMetadata: {
          amount_minor: session.amount_total_minor,
          currency: session.currency,
          livemode: session.livemode,
        },
      });
      if (id === null) {
        console.log('[gp-webhook] duplicate session, no-op', { session_id: session.id });
      } else {
        console.log('[gp-webhook] entitlement issued', { id, user_id: userId, session_id: session.id });
      }
    } catch (err: unknown) {
      // 23503 = FK violation (deleted user). 23505 = unique violation on
      // (user_id, promo_code_id) — race on double-redeem. Both are
      // best-effort ack: log + 200 so GP stops retrying.
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === '23503') {
          console.error('[gp-webhook] user_id references deleted user', { user_id: userId, session_id: session.id });
          return c.body(null, 200);
        }
        if (code === '23505') {
          console.error('[gp-webhook] promo already redeemed (race)', { user_id: userId, promo_code_id: promoCodeId });
          return c.body(null, 200);
        }
      }
      console.error('[gp-webhook] unexpected insert failure', err);
      return c.body(null, 200);
    }

    return c.body(null, 200);
  });
}
