import type { ReactNode } from 'react'

/** Labelled form row. One component so every admin form aligns. */
export function AdminField({
  label,
  hint,
  children,
  mono,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  mono?: boolean
}) {
  return (
    <label className={`admin-field${mono ? ' is-mono' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/** Segmented chooser — locale, role, tier. Cheaper to scan than a select. */
export function AdminChoice<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  /** Renders read-only. Use when the server would refuse the change anyway. */
  disabled?: boolean
}) {
  return (
    <span className={`admin-choice${disabled ? ' is-disabled' : ''}`}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`choice${value === o ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </span>
  )
}
