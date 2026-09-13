import { AdminActions, useAdminPage } from '~/layouts/admin'

export function AdminEntitlementsPage() {
  useAdminPage('Monetization', 'Entitlements')
  return (
    <>
      <AdminActions>
        <button type="button" className="btn btn-primary btn-sm rounded-pill">
          Grant entitlement
        </button>
      </AdminActions>

      <div className="admin-placeholder">
        <div className="panel">
          <h2>Entitlements</h2>
          <p>
            Browse by state and source. Granting composes the scope from tag chips so identifiers
            are always fully qualified, with a live count of what the scope actually unlocks —
            zero shows red, because the user would pay and unlock nothing.
          </p>
          <p>Revoking sets <code>valid_until</code> to now; nothing is deleted.</p>
        </div>
      </div>
    </>
  )
}
