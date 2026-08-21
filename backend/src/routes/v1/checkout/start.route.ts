import type { Hono } from 'hono';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '~/config';
import { errors } from '~/lib/error';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { PromoCode } from '~/models/promo-code';
import { User } from '~/models/user';
import { createCheckoutSession, createCustomer } from './galalem-payments.helper';
import { computePrice } from './pricing.helper';
import type { CheckoutEnv } from './types';

// scope_filter.tags = Odoo polish-notation array: strings (tag leaves) and
// "&"/"|" operator tokens. Recursion depth is bounded — the array is flat,
// operators just consume the next two elements at eval time.
const ScopeFilter = z
  .object({
    tags: z.array(z.string().min(1)).max(64),
  })
  .nullable()
  .optional();

const StartBody = z.object({
  validity_until: z.string().datetime({ offset: true }),
  scope_filter: ScopeFilter,
  promo_code: z.string().min(1).nullable().optional(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  image_url: z.string().url().optional(),
});

const MIN_VALIDITY_MS = 24 * 60 * 60 * 1000;         // 1 day
const MAX_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;   // 365 days

export default function registerRoutes(app: Hono<CheckoutEnv>): void {
  app.post('/start', validate('json', StartBody), async (c) => {
    const body = c.req.valid('json');
    const user = c.get('user');

    // 1. validity window
    const validityUntil = new Date(body.validity_until);
    const deltaMs = validityUntil.getTime() - Date.now();
    if (deltaMs < MIN_VALIDITY_MS || deltaMs > MAX_VALIDITY_MS) {
      throw errors.checkoutValidityOutOfRange();
    }

    // 2. scope_filter shape is enforced by zod above; deeper Odoo-domain
    // sanity is best-effort — the evaluator fails closed on malformed input.

    // 3. locale fallback chain: body → Accept-Language → users.locale → 'fr'
    const locale = body.locale ?? c.get('locale') ?? user.locale ?? 'fr';

    // 4. promo lookup + already-redeemed guard
    let promoCodeId: string | null = null;
    let promoDiscount: number | null = null;
    if (body.promo_code) {
      const promo = await PromoCode.findActiveByCode(body.promo_code);
      if (!promo) throw errors.promoCodeInvalid();
      if (await PromoCode.hasUserRedeemed(user.id, promo.id)) {
        throw errors.promoCodeAlreadyRedeemed();
      }
      promoCodeId = promo.id;
      promoDiscount = promo.discount;
    }

    // 5. price (placeholder formula, see pricing.helper.ts)
    const price = computePrice(validityUntil, promoDiscount);

    // 6. lazy-create customer on GP
    let customerId = await User.getCustomerId(user.id);
    if (!customerId) {
      const cus = await createCustomer({
        userId: user.id,
        email: user.email,
        name: user.fullName,
      });
      customerId = cus.id;
      await User.setCustomerId(user.id, customerId);
    }

    // 7. build spec-compliant metadata (GP enforces flat string→string,
    // max 50 keys, values ≤ 500 chars). Serialize the scope filter; drop
    // null promo id rather than stringifying "null".
    const metadata: Record<string, string> = {
      user_id: user.id,
      validity_until: validityUntil.toISOString(),
      scope_filter: JSON.stringify(body.scope_filter ?? null),
    };
    if (promoCodeId) metadata['promo_code_id'] = promoCodeId;

    // 8. create the hosted session
    const session = await createCheckoutSession({
      customerId,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
      locale,
      currency: price.currency,
      lineItems: [
        {
          name: body.title,
          amount_minor: price.amount_minor,
          quantity: 1,
          ...(body.description ? { description: body.description } : {}),
          ...(body.image_url ? { image_url: body.image_url } : {}),
        },
      ],
      metadata,
    });

    return responses.content(c, { redirect_url: session.url });
  });
}
