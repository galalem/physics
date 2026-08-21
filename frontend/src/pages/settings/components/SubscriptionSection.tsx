import { T, useLocale } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'
import { useEffect, useState } from 'react'
import { closeSettings } from '~/hooks'
import { type Entitlement, settings, type SubscriptionSummary } from '~/lib/settings'

const DAY_MS = 86_400_000

export function SubscriptionSection() {
  const { __ } = useLocale()
  const [data, setData] = useState<SubscriptionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await settings.getSubscription()
      if (cancelled) return
      if (res.error) setError(res.error.message)
      else setData(res.content)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const primary = data?.active[0] ?? null

  return (
    <section className="settings-section">
      <header>
        <h2><T>pages.settings.subscription.title</T></h2>
        <p><T>pages.settings.subscription.description</T></p>
      </header>

      {loading && <div className="loading"><T>common.literal.loading</T></div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && (
        <>
          {primary ? <ActiveBadge entitlement={primary} /> : <EmptyBadge />}

          {data && data.active.length > 1 && (
            <div className="row-hint">
              {__('pages.settings.subscription.multi_plan_hint').replace('{n}', String(data.active.length))}
            </div>
          )}

          <PurchaseHistoryTable rows={data?.history ?? []} />
        </>
      )}
    </section>
  )
}

function ActiveBadge({ entitlement }: { entitlement: Entitlement }) {
  const { __ } = useLocale()
  const grantedAt = new Date(entitlement.grantedAt).getTime()
  const validUntil = new Date(entitlement.validUntil).getTime()
  const now = Date.now()
  const total = Math.max(1, validUntil - grantedAt)
  const consumed = Math.min(1, Math.max(0, (now - grantedAt) / total))
  const daysRemaining = Math.max(0, Math.ceil((validUntil - now) / DAY_MS))
  const sourceLabel = entitlement.source === 'admin_grant'
    ? __('pages.settings.subscription.source_admin_grant')
    : __('pages.settings.subscription.source_purchase')
  const pct = Math.round(consumed * 100)
  const pctLabel = __('pages.settings.subscription.pct_consumed').replace('{pct}', String(pct))
  const daysLabel = daysRemaining === 1
    ? __('pages.settings.subscription.day_remaining')
    : __('pages.settings.subscription.days_remaining').replace('{n}', String(daysRemaining))

  return (
    <div className="sub-card active">
      <div className="sub-badge"><T>pages.settings.subscription.active_badge</T></div>
      <div className="sub-heading"><T>pages.settings.subscription.full_catalog_access</T></div>
      <div className="sub-meta">
        <span>{sourceLabel}</span>
        <span>·</span>
        <span>{__('pages.settings.subscription.ends_on').replace('{date}', formatDate(entitlement.validUntil))}</span>
      </div>
      <div className="sub-progress" aria-label={pctLabel}>
        <div className="bar"><span style={{ width: `${consumed * 100}%` }} /></div>
        <div className="bar-label">
          <span>{daysLabel}</span>
          <span>{pctLabel}</span>
        </div>
      </div>
      <div className="sub-actions">
        <Link to="/pricing" className="btn btn-sm btn-outline-dark rounded-pill" onClick={closeSettings}>
          <T>pages.settings.subscription.extend_cta</T>
        </Link>
      </div>
    </div>
  )
}

function EmptyBadge() {
  return (
    <div className="sub-card empty">
      <div className="sub-badge muted"><T>pages.settings.subscription.empty_badge</T></div>
      <div className="sub-heading"><T>pages.settings.subscription.empty_heading</T></div>
      <p><T>pages.settings.subscription.empty_body</T></p>
      <div className="sub-actions">
        <Link to="/pricing" className="btn btn-sm btn-primary rounded-pill" onClick={closeSettings}>
          <T>pages.settings.subscription.empty_cta</T>
        </Link>
      </div>
    </div>
  )
}

function PurchaseHistoryTable({ rows }: { rows: Entitlement[] }) {
  if (rows.length === 0) return null
  return (
    <div className="history">
      <h3><T>pages.settings.subscription.history_title</T></h3>
      <table>
        <thead>
          <tr>
            <th><T>pages.settings.subscription.history_col_date</T></th>
            <th><T>pages.settings.subscription.history_col_plan</T></th>
            <th><T>pages.settings.subscription.history_col_amount</T></th>
            <th><T>pages.settings.subscription.history_col_valid_until</T></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.grantedAt)}</td>
              <td><T>pages.settings.subscription.full_catalog_access</T></td>
              <td>{r.amountMinor != null && r.currency ? `${Math.round(r.amountMinor / 1000)} ${r.currency}` : '—'}</td>
              <td>{formatDate(r.validUntil)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
