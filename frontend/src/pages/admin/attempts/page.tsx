import { useAdminPage } from '~/layouts/admin'

export function AdminAttemptsPage() {
  useAdminPage('Insights', 'Attempts')
  return (
    <div className="admin-placeholder">
      <div className="panel">
        <h2>Attempts</h2>
        <p>
          Read-only analytics: volume, completion and success rates, median duration, completion
          by exercise, and the raw log.
        </p>
        <p className="blocked">
          <strong>One chart has no data behind it.</strong> The design’s stage drop-off needs
          stage-level records; <code>attempts</code> stores start/last-action/completion and a
          log, but nothing per stage.
        </p>
      </div>
    </div>
  )
}
