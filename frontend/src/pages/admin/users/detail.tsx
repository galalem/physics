import { Link, useRouter } from '@galalem/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useMe } from '~/hooks/useMe'
import { AdminConfirm, useAdminPage } from '~/layouts/admin'
import { adminUsers, type AdminUserDetail } from '~/lib/admin-users'
import { UserFormModal } from './UserFormModal'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Best-effort device label from a user agent. Deliberately coarse — this
 * is for recognising "my laptop" vs "my phone" in a support call, not for
 * analytics. The raw string stays available on hover.
 */
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const os = /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Mac OS X/i.test(ua) ? 'macOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS'
  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari' : 'Unknown browser'
  return `${browser} · ${os}`
}

/** `null` scope means the whole catalogue. */
function scopeLabel(scope: { tags?: unknown } | null): string {
  if (!scope || scope.tags == null) return 'everything'
  return JSON.stringify(scope.tags)
}

type ConfirmKind = 'disable' | 'delete' | 'signout' | null

export function AdminUserDetailPage() {
  const router = useRouter()
  const id = router.params.id as string

  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [editing, setEditing] = useState(false)

  // The server refuses disable and delete on your own row (single-operator
  // lockout). Mirror those two refusals here so the console never offers a
  // button whose only outcome is an error.
  const { me } = useMe()

  useAdminPage('Users', user ? user.fullName : 'User')

  const load = useCallback(async () => {
    const res = await adminUsers.read(id)
    if (res.error) setError(res.error.message)
    else {
      setError(null)
      setUser(res.content)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<{ error?: unknown }>) => {
    setBusy(true)
    await fn()
    setConfirm(null)
    setBusy(false)
    await load()
  }

  if (error) {
    return (
      <div className="admin-placeholder">
        <div className="panel">
          <h2>Could not load this user</h2>
          <p>{error}</p>
          <Link to="/admin/users" className="btn btn-sm rounded-pill btn-outline-secondary">Back to users</Link>
        </div>
      </div>
    )
  }
  if (!user) return <div className="admin-empty">Loading…</div>

  const isSelf = me?.id === user.id

  return (
    <>
      <Link to="/admin/users" className="admin-back">
        <span className="icon-rtl-flip">←</span> All users
      </Link>

      <div className="admin-detail">
        <div className="col-main">
          {/* Sessions */}
          <section className="admin-panel">
            <header>
              <h2>Sessions</h2>
              {user.sessions.length > 0 && (
                <button type="button" className="mini" onClick={() => setConfirm('signout')}>
                  Sign out everywhere
                </button>
              )}
            </header>
            {user.sessions.length === 0 ? (
              <p className="muted">No active sessions.</p>
            ) : (
              <ul className="rows">
                {user.sessions.map((s) => (
                  <li key={s.id}>
                    <div>
                      <div className="strong" title={s.userAgent ?? undefined}>{deviceLabel(s.userAgent)}</div>
                      <div className="sub mono">last seen {fmt(s.lastUsedAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="mini"
                      disabled={busy}
                      onClick={() => run(() => adminUsers.revokeSession(user.id, s.id))}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="footnote">No IP address is recorded — device and timestamps are all the session stores.</p>
          </section>

          {/* Entitlements */}
          <section className="admin-panel">
            <header><h2>Entitlements</h2></header>
            {user.entitlements.length === 0 ? (
              <p className="muted">No active entitlements — this account only reaches free-tier exercises.</p>
            ) : (
              <ul className="rows">
                {user.entitlements.map((e) => (
                  <li key={e.id}>
                    <div>
                      <div className="strong mono">{scopeLabel(e.scopeFilter)}</div>
                      <div className="sub mono">
                        {e.source} · granted {fmt(e.grantedAt)} · until {fmt(e.validUntil)}
                      </div>
                    </div>
                    <span className={`pill ${e.unlocks === 0 ? 'is-danger' : 'is-neutral'}`}>
                      {e.unlocks} exercises
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="footnote">
              This panel answers “why can’t I open exercise X?”. A scope showing <strong>0 exercises</strong> matches
              nothing — the user paid and unlocked none.
            </p>
          </section>

          {/* Activity */}
          <section className="admin-panel">
            <header><h2>Activity</h2></header>
            <div className="stat-row">
              <div><span className="figure">{user.attempts.total}</span><span className="label">attempts</span></div>
              <div><span className="figure">{user.attempts.completed}</span><span className="label">completed</span></div>
              <div><span className="figure">{user.attempts.succeeded}</span><span className="label">succeeded</span></div>
            </div>
            <p className="footnote">Last activity {fmt(user.attempts.lastActivityAt)}.</p>
          </section>
        </div>

        <div className="col-side">
          <section className="admin-panel">
            <header>
              <h2>Account</h2>
              <button type="button" className="mini" onClick={() => setEditing(true)}>Edit</button>
            </header>
            <dl className="kv">
              <dt>Email</dt><dd className="mono">{user.email}</dd>
              <dt>Role</dt><dd className="mono">{user.role}</dd>
              <dt>Locale</dt><dd className="mono">{user.locale}</dd>
              <dt>Verified</dt><dd className="mono">{user.emailVerified ? 'yes' : 'no'}</dd>
              <dt>Active</dt><dd className="mono">{user.active ? 'yes' : 'no'}</dd>
              <dt>Tutorial</dt><dd className="mono">{user.tutorialOutcome ?? 'not taken'}</dd>
              <dt>Failed logins</dt><dd className="mono">{user.failedLoginCount}</dd>
              <dt>Customer</dt><dd className="mono">{user.customerId ?? '—'}</dd>
              <dt>Created</dt><dd className="mono">{fmt(user.createdAt)}</dd>
            </dl>
          </section>

          <section className="admin-panel is-danger">
            <header><h2>Danger zone</h2></header>

            {user.status === 'locked' && (
              <div className="danger-action">
                <div>
                  <div className="strong">Locked out</div>
                  <p>Clears automatically, but a support call wants it now.</p>
                </div>
                <button type="button" className="mini" disabled={busy} onClick={() => run(() => adminUsers.unlock(user.id))}>
                  Unlock
                </button>
              </div>
            )}

            <div className="danger-action">
              <div>
                <div className="strong">{user.active ? 'Disable account' : 'Enable account'}</div>
                <p>
                  {isSelf && user.active
                    ? 'You cannot disable your own account — with a single operator that lockout has no in-app way back.'
                    : user.active
                      ? 'Takes effect immediately — the session check runs on every request, so they are signed out mid-session.'
                      : 'Restores access. The account keeps everything it had.'}
                </p>
              </div>
              <button
                type="button"
                className="mini"
                disabled={busy || (isSelf && user.active)}
                onClick={() => (user.active ? setConfirm('disable') : run(() => adminUsers.enable(user.id)))}
              >
                {user.active ? 'Disable' : 'Enable'}
              </button>
            </div>

            <div className="danger-action">
              <div>
                <div className="strong">{user.deletedAt ? 'Restore account' : 'Delete account'}</div>
                <p>
                  {isSelf && !user.deletedAt
                    ? 'You cannot delete your own account. Erasing your own data is on the profile page, as a user.'
                    : user.deletedAt
                      ? 'Undoes the soft delete. Nothing was destroyed.'
                      : 'Soft delete — history is preserved. Permanent erasure is user-initiated only.'}
                </p>
              </div>
              <button
                type="button"
                className="mini"
                disabled={busy || (isSelf && !user.deletedAt)}
                onClick={() => (user.deletedAt ? run(() => adminUsers.restore(user.id)) : setConfirm('delete'))}
              >
                {user.deletedAt ? 'Restore' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      </div>

      {editing && (
        <UserFormModal user={user} onClose={() => setEditing(false)} onSaved={load} />
      )}

      {confirm === 'signout' && (
        <AdminConfirm
          tone="light"
          title="Sign out everywhere"
          body={
            `Ends all ${user.sessions.length} active session${user.sessions.length === 1 ? '' : 's'} for ${user.fullName}.` +
            // Allowed on purpose — signing yourself out costs a log-in, it
            // does not lock you out. It just must not be a surprise.
            (isSelf ? ' That includes the session you are using right now, so you will be signed out of the console.' : '')
          }
          note="They can sign back in immediately — this only drops the devices."
          confirmLabel="Sign out everywhere"
          busy={busy}
          onConfirm={() => run(() => adminUsers.revokeSessions(user.id))}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === 'disable' && (
        <AdminConfirm
          tone="light"
          title="Disable account"
          body={`${user.fullName} will be signed out and unable to log in.`}
          note="Reversible — enabling restores access with everything intact."
          confirmLabel="Disable"
          busy={busy}
          onConfirm={() => run(() => adminUsers.disable(user.id))}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === 'delete' && (
        <AdminConfirm
          tone="heavy"
          title="Delete account"
          heading="This hides the account everywhere"
          body={`${user.fullName} disappears from the catalogue side of the product and can no longer sign in. Their attempts, entitlements and history are preserved, and the account can be restored.`}
          note="Permanent erasure is not available here — it is user-initiated only, from their own settings."
          typeTarget={user.email}
          confirmLabel="Delete account"
          busy={busy}
          onConfirm={() => run(() => adminUsers.remove(user.id))}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
