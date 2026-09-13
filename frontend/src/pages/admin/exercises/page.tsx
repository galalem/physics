import { useAdminPage } from '~/layouts/admin'

export function AdminExercisesPage() {
  useAdminPage('Content', 'Exercises')
  return (
    <div className="admin-placeholder">
      <div className="panel">
        <h2>Exercises</h2>
        <p>
          Search, filters, and multi-select with bulk tier assignment — 109 of 125 exercises sit
          at <code>beta</code> and need real pricing. Editing opens a modal with a live KaTeX
          preview and per-locale title/description.
        </p>
      </div>
    </div>
  )
}
