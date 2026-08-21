import type { Hono } from 'hono';
import { responses } from '~/lib/response';
import { Entitlement } from '~/models/entitlement';
import type { MyEnv } from './types';

// GET /my/subscription   Subscription summary for the settings modal.
//                        Returns active entitlements (union access) + full
//                        purchase history (source='purchase' only) so the
//                        client can render badge + progress bar + table.
export default function registerRoutes(app: Hono<MyEnv>): void {
  app.get('/subscription', async (c) => {
    const user = c.get('user');
    const active = await Entitlement.activeForUser(user.id);
    const history = await Entitlement.purchaseHistoryForUser(user.id);
    c.header('Cache-Control', 'no-store');
    return responses.content(c, {
      active: active.map(shape),
      history: history.map(shape),
    });
  });
}

function shape(row: {
  id: string;
  granted_at: Date;
  valid_until: Date;
  source: string;
  scope_filter: { tags?: unknown } | null;
  payment_metadata: Record<string, unknown> | null;
}) {
  const meta = row.payment_metadata ?? {};
  return {
    id: row.id,
    grantedAt: row.granted_at.toISOString(),
    validUntil: row.valid_until.toISOString(),
    source: row.source,
    scopeFilter: row.scope_filter,
    amountMinor: typeof meta['amount_minor'] === 'number' ? meta['amount_minor'] : null,
    currency: typeof meta['currency'] === 'string' ? meta['currency'] : null,
  };
}
