import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Modal shell for every admin area: header (eyebrow + title + Close),
 * scrollable body, footer (optional note, Cancel, primary confirm).
 *
 * Two widths — `wide` (940px) for the exercise editor, default (560px)
 * for everything else. Top-aligned with generous padding so a tall modal
 * scrolls with the page rather than trapping content off-screen.
 */
export interface AdminModalProps {
  eyebrow: string
  title: string
  children: ReactNode
  /** Quiet footnote on the left of the footer. */
  note?: ReactNode
  confirmLabel: string
  /** Disables the primary button — e.g. a form that has not been touched. */
  confirmDisabled?: boolean
  /** Red primary, for destructive confirms. */
  destructive?: boolean
  busy?: boolean
  error?: string | null
  wide?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function AdminModal({
  eyebrow,
  title,
  children,
  note,
  confirmLabel,
  confirmDisabled,
  destructive,
  busy,
  error,
  wide,
  onConfirm,
  onClose,
}: AdminModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="admin-modal-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`admin-modal${wide ? '' : ' is-narrow'}`} role="dialog" aria-modal="true">
        <div className="head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <div className="title">{title}</div>
          </div>
          <button type="button" className="mini" onClick={onClose}>Close</button>
        </div>

        <div className="body">{children}</div>

        {error && <div className="modal-error">{error}</div>}

        <div className="foot">
          {note && <span className="foot-note">{note}</span>}
          <button type="button" className="btn btn-sm rounded-pill btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn btn-sm rounded-pill ${destructive ? 'btn-danger' : 'btn-primary'}`}
            disabled={confirmDisabled || busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
