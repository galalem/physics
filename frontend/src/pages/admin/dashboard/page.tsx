import { useAdminPage } from '~/layouts/admin'

export function AdminDashboardPage() {
  useAdminPage('Overview', 'Dashboard')
  return (
    <div className="admin-placeholder">
      <div className="panel">
        <h2>Dashboard</h2>
        <p>
          Five stat cards, most-played exercises, a “needs attention” list that deep-links into
          each area with a filter pre-applied, and recent activity.
        </p>
      </div>
    </div>
  )
}
