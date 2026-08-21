import { type Db, sql } from '~/lib/db';

export interface PromoCodeRow {
  id: string;
  code: string;
  discount: number;
  active: boolean;
  created_at: Date;
}

export class PromoCode {
  static async findActiveByCode(code: string, db: Db = sql): Promise<PromoCodeRow | null> {
    const [row] = await db<PromoCodeRow[]>`
      SELECT id, code, discount, active, created_at
      FROM promo_codes
      WHERE code = ${code} AND active = true
    `;
    return row ?? null;
  }

  static async hasUserRedeemed(
    userId: string,
    promoCodeId: string,
    db: Db = sql,
  ): Promise<boolean> {
    const [row] = await db<{ n: string }[]>`
      SELECT COUNT(*)::text AS n
      FROM entitlements
      WHERE user_id = ${userId} AND promo_code_id = ${promoCodeId}
    `;
    return Number(row!.n) > 0;
  }
}
