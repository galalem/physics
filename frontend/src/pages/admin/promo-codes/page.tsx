import { AdminActions, useAdminPage } from '~/layouts/admin'

export function AdminPromoCodesPage() {
  useAdminPage('Monetization', 'Promo codes')
  return (
    <>
      <AdminActions>
        <button type="button" className="btn btn-primary btn-sm rounded-pill">
          New code
        </button>
      </AdminActions>

      <div className="admin-placeholder">
        <div className="panel">
          <h2>Promo codes</h2>
          <p>
            Code, discount, redemptions, state. Codes are never typed by users — the frontend
            applies a campaign code invisibly on the relevant call-to-action, so a code behaves
            like a switch attached to a campaign.
          </p>
        </div>
      </div>
    </>
  )
}
