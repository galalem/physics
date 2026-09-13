import { AdminActions, useAdminPage } from '~/layouts/admin'

export function AdminTagsPage() {
  useAdminPage('Content', 'Tags')
  return (
    <>
      <AdminActions>
        <button type="button" className="btn btn-primary btn-sm rounded-pill">
          New tag
        </button>
      </AdminActions>

      <div className="admin-placeholder">
        <div className="panel">
          <h2>Tags</h2>
          <p>
            The family/tag tree with per-locale labels. Slugs are identifiers and stay read-only.
          </p>
          <p className="blocked">
            <strong>Guard required before delete ships.</strong> Entitlement scopes store tag
            identifiers as plain strings with no foreign key, so deleting a referenced tag
            silently stops that entitlement matching anything and a paying customer loses access
            with no error surfaced.
          </p>
        </div>
      </div>
    </>
  )
}
