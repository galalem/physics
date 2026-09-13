import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Destructive-action confirm, at two weights.
 *
 * - **light** — reversible (disable an account). Body copy, a grey note
 *   explaining the reversibility, and a red button with no friction.
 * - **heavy** — the action has consequences that are not obvious from the
 *   button. A red-tinted header, an optional referenced-by list showing
 *   what depends on the object, and a type-to-confirm input that keeps the
 *   button disabled until the typed string matches exactly.
 *
 * Shared because every admin area needs it and the weights must not drift:
 * deleting a tag that entitlements depend on is not the same kind of act
 * as disabling one account.
 */
export type ConfirmTone = 'light' | 'heavy'

export interface AdminConfirmProps {
  tone: ConfirmTone
  title: string
  /** Shown in the red header block on `heavy`. */
  heading?: string
  body: ReactNode
  /** Grey footnote — used on `light` to say why this is reversible. */
  note?: ReactNode
  /** `heavy` only: the exact string the operator must type. */
  typeTarget?: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function AdminConfirm({
  tone,
  title,
  heading,
  body,
  note,
  typeTarget,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: AdminConfirmProps) {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const locked = !!typeTarget && typed !== typeTarget

  return createPortal(
    <div className="admin-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal is-narrow" role="dialog" aria-modal="true">
        <div className="head">
          <div>
            <div className="eyebrow">Confirm</div>
            <div className="title">{title}</div>
          </div>
          <button type="button" className="mini" onClick={onClose}>Close</button>
        </div>

        <div className="body">
          {tone === 'heavy' ? (
            <div className="danger-block">
              {heading && <div className="heading">{heading}</div>}
              <div className="copy">{body}</div>
            </div>
          ) : (
            <div className="copy">{body}</div>
          )}

          {note && <div className="note">{note}</div>}

          {typeTarget && (
            <label className="type-confirm">
              <span>
                Type <code>{typeTarget}</code> to confirm
              </span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </label>
          )}
        </div>

        <div className="foot">
          <button type="button" className="btn btn-sm rounded-pill btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm rounded-pill btn-danger"
            disabled={locked || busy}
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
