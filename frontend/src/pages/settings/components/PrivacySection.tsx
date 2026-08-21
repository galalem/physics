import { T, useLocale } from '@galalem/react-localization'
import { useState } from 'react'
import { settings } from '~/lib/settings'
import { DeleteAccountModal } from './DeleteAccountModal'

export function PrivacySection() {
  const [exportOpen, setExportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section className="settings-section">
      <header>
        <h2><T>pages.settings.privacy.title</T></h2>
        <p><T>pages.settings.privacy.description</T></p>
      </header>

      {/* --- Export --- */}
      <div className="row">
        <div className="row-info">
          <div className="row-label"><T>pages.settings.privacy.export_label</T></div>
          <div className="row-value muted"><T>pages.settings.privacy.export_body</T></div>
        </div>
        {!exportOpen ? (
          <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={() => setExportOpen(true)}>
            <T>pages.settings.privacy.export_button</T>
          </button>
        ) : (
          <ExportForm onDone={() => setExportOpen(false)} />
        )}
      </div>

      {/* --- Danger zone --- */}
      <div className="danger-zone">
        <div className="dz-label"><T>pages.settings.privacy.danger_zone</T></div>
        <div className="row">
          <div className="row-info">
            <div className="row-label"><T>pages.settings.privacy.delete_label</T></div>
            <div className="row-value muted">
              <T>pages.settings.privacy.delete_body</T>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-danger rounded-pill" onClick={() => setDeleteOpen(true)}>
            <T>pages.settings.privacy.delete_button</T>
          </button>
        </div>
      </div>

      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} />}
    </section>
  )
}

function ExportForm({ onDone }: { onDone: () => void }) {
  const { __ } = useLocale()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    const res = await settings.exportPersonalData({ password })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    // Trigger a client-side download of the returned JSON.
    const blob = new Blob([JSON.stringify(res.content, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `physics-data-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setPassword('')
    onDone()
  }

  return (
    <div className="inline-form">
      <label>
        <span><T>pages.settings.privacy.export_password_label</T></span>
        <input
          type="password"
          className="form-control"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="inline-actions">
        <button type="button" className="btn btn-sm btn-outline-dark rounded-pill" onClick={onDone} disabled={submitting}>
          <T>common.literal.cancel</T>
        </button>
        <button type="button" className="btn btn-sm btn-primary rounded-pill" onClick={onSubmit} disabled={!password || submitting}>
          {submitting ? __('pages.settings.privacy.export_preparing') : __('pages.settings.privacy.export_download')}
        </button>
      </div>
    </div>
  )
}
