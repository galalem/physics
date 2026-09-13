import { useState } from 'react'
import { useMe } from '~/hooks/useMe'
import { AdminChoice, AdminField, AdminModal } from '~/layouts/admin'
import { adminUsers, type AdminUser } from '~/lib/admin-users'

const LOCALES = ['en', 'fr', 'ar'] as const
const ROLES = ['learner', 'admin', 'expert'] as const

type Locale = (typeof LOCALES)[number]
type Role = (typeof ROLES)[number]

/**
 * One form, two modes.
 *
 * - **invite** — creates the account and emails a one-time link. No
 *   password field exists: the invitee sets their own, which is also what
 *   verifies the address.
 * - **edit** — patches an existing row. Only changed fields are sent.
 *
 * They share a component because the fields are identical; splitting them
 * would mean maintaining the same five inputs twice.
 */
export function UserFormModal({
  user,
  onClose,
  onSaved,
}: {
  /** Absent = invite a new user. */
  user?: AdminUser
  onClose: () => void
  onSaved: () => void
}) {
  const editing = !!user

  // An admin demoting themselves is a lockout no in-app path can undo, so
  // the server refuses it. Lock the control rather than offer a change that
  // comes back as an error.
  const { me } = useMe()
  const isSelf = editing && me?.id === user!.id

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [locale, setLocale] = useState<Locale>((user?.locale as Locale) ?? 'fr')
  const [role, setRole] = useState<Role>((user?.role as Role) ?? 'learner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailChanged = editing && email.trim().toLowerCase() !== user!.email.toLowerCase()
  const becomingExpert = role === 'expert' && user?.role !== 'expert'
  const becomingAdmin = role === 'admin' && user?.role !== 'admin'

  const complete = firstName.trim() && lastName.trim() && email.trim()
  const dirty =
    !editing ||
    firstName.trim() !== user!.firstName ||
    lastName.trim() !== user!.lastName ||
    emailChanged ||
    locale !== user!.locale ||
    role !== user!.role

  const submit = async () => {
    setBusy(true)
    setError(null)

    const res = editing
      ? await adminUsers.update(user!.id, {
          // Only what actually changed — a no-op PATCH would still bump
          // the row and, for email, re-trust an address needlessly.
          ...(firstName.trim() !== user!.firstName ? { firstName: firstName.trim() } : {}),
          ...(lastName.trim() !== user!.lastName ? { lastName: lastName.trim() } : {}),
          ...(emailChanged ? { email: email.trim() } : {}),
          ...(locale !== user!.locale ? { locale } : {}),
          ...(role !== user!.role ? { role } : {}),
        })
      : await adminUsers.invite({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          locale,
          role,
        })

    setBusy(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <AdminModal
      eyebrow={editing ? 'Edit user' : 'Invite user'}
      title={editing ? user!.fullName : 'New account'}
      confirmLabel={editing ? 'Save changes' : 'Send invite'}
      confirmDisabled={!complete || !dirty}
      busy={busy}
      error={error}
      note={editing ? undefined : 'An invite link is emailed; no password is set here.'}
      onConfirm={submit}
      onClose={onClose}
    >
      <div className="field-pair">
        <AdminField label="First name">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </AdminField>
        <AdminField label="Last name">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </AdminField>
      </div>

      <AdminField
        label="Email"
        mono
        hint={
          emailChanged ? (
            <span className="warn">
              Changing this bypasses email verification — the new address is trusted immediately.
            </span>
          ) : undefined
        }
      >
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
        />
      </AdminField>

      <div className="field-pair">
        <AdminField label="Locale">
          <AdminChoice value={locale} options={LOCALES} onChange={setLocale} />
        </AdminField>
        <AdminField label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          <AdminChoice value={role} options={ROLES} onChange={setRole} disabled={isSelf} />
        </AdminField>
      </div>

      {becomingExpert && (
        <div className="inline-note is-teal">
          Granting <strong>expert</strong> adds this person to the reviewer cohort.
        </div>
      )}
      {becomingAdmin && (
        <div className="inline-note is-warn">
          Granting <strong>admin</strong> gives full access to this console, including every user
          record and the ability to grant paid entitlements.
        </div>
      )}
    </AdminModal>
  )
}
