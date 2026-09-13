import { Link } from '@galalem/react-router'
import { useCallback, useEffect, useState } from 'react'
import { AdminActions, useAdminPage } from '~/layouts/admin'
import {
  adminUsers,
  type AdminUser,
  type AdminUserFilter,
} from '~/lib/admin-users'
import { UserFormModal } from './UserFormModal'

const FILTERS: { value: AdminUserFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'locked', label: 'Locked' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'disabled', label: 'Disabled' },
]

const PAGE_SIZE = 25

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Status is computed server-side; this only picks its colour. */
function StatusBadges({ user }: { user: AdminUser }) {
  const badges: { label: string; tone: string }[] = []
  if (user.deletedAt) badges.push({ label: 'deleted', tone: 'danger' })
  if (!user.active && !user.deletedAt) badges.push({ label: 'disabled', tone: 'danger' })
  if (user.status === 'locked') badges.push({ label: 'locked', tone: 'warning' })
  if (!user.emailVerified) badges.push({ label: 'unverified', tone: 'warning' })
  if (user.role !== 'learner') badges.push({ label: user.role, tone: 'info' })
  if (!badges.length) badges.push({ label: 'active', tone: 'success' })

  return (
    <span className="badges">
      {badges.map((b) => (
        <span key={b.label} className={`pill is-${b.tone}`}>{b.label}</span>
      ))}
    </span>
  )
}

export function AdminUsersPage() {
  useAdminPage('Users', 'Users')

  const [rows, setRows] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AdminUserFilter>('all')
  const [showDeleted, setShowDeleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await adminUsers.list({ q: query, status: filter, includeDeleted: showDeleted, page, size: PAGE_SIZE })
    if (res.error) {
      setError(res.error.message)
      setRows([])
    } else {
      setError(null)
      setRows(res.content)
      setTotal(res.totalElements)
    }
    setLoading(false)
  }, [query, filter, showDeleted, page])

  // Debounced so typing in the search box does not fire a request per key.
  useEffect(() => {
    const t = setTimeout(load, 220)
    return () => clearTimeout(t)
  }, [load])

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1)
  }, [query, filter, showDeleted])

  const act = async (id: string, fn: () => Promise<{ error?: unknown }>) => {
    setBusyId(id)
    await fn()
    await load()
    setBusyId(null)
  }

  const totalPages = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE)

  return (
    <>
      <AdminActions>
        <button
          type="button"
          className="btn btn-primary btn-sm rounded-pill"
          onClick={() => setInviting(true)}
        >
          Invite user
        </button>
      </AdminActions>

      <div className="admin-toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search email or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip${filter === f.value ? ' is-active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          <span>Show deleted</span>
        </label>
      </div>

      <div className="admin-table-card">
        {error ? (
          <div className="admin-empty">
            <p>{error}</p>
            <button type="button" className="btn btn-sm rounded-pill btn-outline-secondary" onClick={load}>
              Retry
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Locale</th>
                  <th>Status</th>
                  <th>Tutorial</th>
                  <th>Joined</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className={u.deletedAt || !u.active ? 'is-dimmed' : undefined}>
                    <td>
                      <Link to={`/admin/users/${u.id}`} className="row-link">{u.fullName}</Link>
                    </td>
                    <td className="mono">{u.email}</td>
                    <td className="mono">{u.locale}</td>
                    <td><StatusBadges user={u} /></td>
                    <td className="mono">{u.tutorialOutcome ?? '—'}</td>
                    <td className="mono">{fmtDate(u.createdAt)}</td>
                    <td className="row-actions">
                      {u.status === 'locked' && (
                        <button
                          type="button"
                          className="mini"
                          disabled={busyId === u.id}
                          onClick={() => act(u.id, () => adminUsers.unlock(u.id))}
                        >
                          Unlock
                        </button>
                      )}
                      {!u.emailVerified && !u.deletedAt && (
                        <button
                          type="button"
                          className="mini"
                          disabled={busyId === u.id}
                          onClick={() => act(u.id, () => adminUsers.resendInvite(u.id))}
                        >
                          Resend invite
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && !loading && (
                  <tr>
                    <td colSpan={7} className="admin-empty-cell">
                      No users match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="admin-table-foot">
          <span className="count mono">
            {loading ? 'Loading…' : `${total} user${total === 1 ? '' : 's'}`}
          </span>
          {totalPages > 1 && (
            <span className="pager">
              <button type="button" className="mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="mono">{page} / {totalPages}</span>
              <button type="button" className="mini" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </span>
          )}
        </div>
      </div>

      {inviting && <UserFormModal onClose={() => setInviting(false)} onSaved={load} />}
    </>
  )
}
