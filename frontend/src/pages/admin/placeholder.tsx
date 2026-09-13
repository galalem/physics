import { useAdminPage } from '~/layouts/admin'

/**
 * Shared body for admin areas that are scaffolded but not built, and for
 * the three nav entries whose backing tracks do not exist yet. Says what
 * the area will do rather than "coming soon", so the nav is honest.
 */
export function AdminPlaceholder({
  crumb,
  title,
  scope,
  blockedBy,
}: {
  crumb: string
  title: string
  scope: string
  blockedBy?: string
}) {
  useAdminPage(crumb, title)

  return (
    <div className="admin-placeholder">
      <div className="panel">
        <h2>{title}</h2>
        <p>{scope}</p>
        {blockedBy && (
          <p className="blocked">
            <strong>Not buildable yet.</strong> {blockedBy}
          </p>
        )}
      </div>
    </div>
  )
}
