import { type Db, sql } from '~/lib/db';

export interface EntitlementRow {
  id: string;
  user_id: string;
  granted_at: Date;
  valid_until: Date;
  scope_filter: { tags?: unknown } | null;
  source: string;
  promo_code_id: string | null;
  payment_charge_id: string | null;
  payment_metadata: Record<string, unknown> | null;
}

export interface InsertPurchaseParams {
  userId: string;
  validUntil: Date;
  scopeFilter: { tags?: unknown } | null;
  promoCodeId: string | null;
  paymentChargeId: string;
  paymentMetadata: Record<string, unknown>;
}

export class Entitlement {
  static async activeForUser(userId: string, db: Db = sql): Promise<EntitlementRow[]> {
    return db<EntitlementRow[]>`
      SELECT id, user_id, granted_at, valid_until, scope_filter, source,
             promo_code_id, payment_charge_id, payment_metadata
      FROM entitlements
      WHERE user_id = ${userId} AND valid_until > now()
      ORDER BY valid_until DESC
    `;
  }

  static async purchaseHistoryForUser(userId: string, db: Db = sql): Promise<EntitlementRow[]> {
    return db<EntitlementRow[]>`
      SELECT id, user_id, granted_at, valid_until, scope_filter, source,
             promo_code_id, payment_charge_id, payment_metadata
      FROM entitlements
      WHERE user_id = ${userId} AND source = 'purchase'
      ORDER BY granted_at DESC
    `;
  }

  // Idempotent on payment_charge_id (unique partial index). Duplicate
  // webhook replay → no-op, returns `null`. First insert → returns the id.
  static async insertPurchase(p: InsertPurchaseParams, db: Db = sql): Promise<string | null> {
    const [row] = await db<{ id: string }[]>`
      INSERT INTO entitlements
        (user_id, valid_until, scope_filter, source,
         promo_code_id, payment_charge_id, payment_metadata)
      VALUES
        (${p.userId}, ${p.validUntil}, ${sql.json(p.scopeFilter as never)}, 'purchase',
         ${p.promoCodeId}, ${p.paymentChargeId}, ${sql.json(p.paymentMetadata as never)})
      ON CONFLICT (payment_charge_id) DO NOTHING
      RETURNING id
    `;
    return row?.id ?? null;
  }
}
