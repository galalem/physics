import { T, useLocale } from '@galalem/react-localization'
import { useEffect, useMemo, useRef, useState } from 'react'
import { computePriceTND, formatTND } from '../pricing'

interface Props {
  onSubscribe: (days: number) => void
  busy?: boolean
}

// Default target: the next 30-June (end of the Tunisian bac window). If
// today is already past that in the current year, jump to next year.
const MIN_DAYS = 1
const MAX_DAYS = 365

function nextJune30(): string {
  const today = new Date()
  const past = today.getMonth() > 5 || (today.getMonth() === 5 && today.getDate() >= 30)
  const year = past ? today.getFullYear() + 1 : today.getFullYear()
  return `${year}-06-30`
}

function toInputValue(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function diffDaysFromToday(iso: string): number {
  const target = new Date(iso + 'T00:00:00Z').getTime()
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
  return Math.round((target - today) / 86_400_000)
}

export function CustomPlanCard({ onSubscribe, busy }: Props) {
  const { __ } = useLocale()
  const [flipped, setFlipped] = useState(false)
  const [dateStr, setDateStr] = useState(nextJune30)
  const cardRef = useRef<HTMLElement>(null)

  // Click outside the card while flipped → collapse back to the front.
  // Only listens while flipped, so we don't burn a global listener idle.
  useEffect(() => {
    if (!flipped) return
    function onDocPointer(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setFlipped(false)
      }
    }
    document.addEventListener('mousedown', onDocPointer)
    return () => document.removeEventListener('mousedown', onDocPointer)
  }, [flipped])

  const days = useMemo(() => diffDaysFromToday(dateStr), [dateStr])
  const valid = days >= MIN_DAYS && days <= MAX_DAYS
  const price = valid ? computePriceTND(days) : 0

  const minDateStr = toInputValue(MIN_DAYS)
  const maxDateStr = toInputValue(MAX_DAYS)

  return (
    <article ref={cardRef} className={`pricing-card custom ${flipped ? 'is-flipped' : ''}`}>
      <div className="inner">
        <div className="face front">
          <header>
            <div className="label"><T>pages.pricing.tier_custom_label</T></div>
            <div className="tagline"><T>pages.pricing.tier_custom_front_tagline</T></div>
          </header>
          <div className="custom-illustration" aria-hidden="true">
            <svg viewBox="0 0 120 80" width="120" height="80">
              <rect x="8" y="18" width="104" height="54" rx="8" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="8" y1="34" x2="112" y2="34" stroke="currentColor" strokeWidth="2" />
              <circle cx="30" cy="10" r="4" fill="currentColor" />
              <circle cx="90" cy="10" r="4" fill="currentColor" />
              <line x1="30" y1="10" x2="30" y2="22" stroke="currentColor" strokeWidth="2" />
              <line x1="90" y1="10" x2="90" y2="22" stroke="currentColor" strokeWidth="2" />
              <rect x="26" y="46" width="14" height="14" fill="#f97316" opacity="0.85" />
              <rect x="52" y="46" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="78" y="46" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <ul>
            <li><i className="bi bi-check2" aria-hidden="true" /><span><T>pages.pricing.bullet_full_catalog</T></span></li>
            <li><i className="bi bi-check2" aria-hidden="true" /><span><T>pages.pricing.bullet_any_period</T></span></li>
            <li><i className="bi bi-check2" aria-hidden="true" /><span><T>pages.pricing.bullet_per_day</T></span></li>
          </ul>
          <button
            type="button"
            className="btn btn-outline-dark rounded-pill w-100"
            onClick={() => setFlipped(true)}
          >
            <T>pages.pricing.custom_find_out</T>
          </button>
        </div>

        <div className="face back">
          <header>
            <div className="label"><T>pages.pricing.tier_custom_label</T></div>
            <div className="tagline"><T>pages.pricing.tier_custom_back_tagline</T></div>
          </header>
          <div className="price">
            <span className="amount">{valid ? formatTND(price) : '—'}</span>
            <span className="period">{__('pages.pricing.period').replace('{n}', String(valid ? days : 0))}</span>
          </div>
          <p className="pitch"><T>pages.pricing.custom_pitch</T></p>
          <input
            type="date"
            className="form-control form-control-lg date"
            value={dateStr}
            min={minDateStr}
            max={maxDateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary rounded-pill w-100"
            onClick={() => valid && onSubscribe(days)}
            disabled={!valid || busy}
          >
            <T>{busy ? 'pages.pricing.redirecting' : 'pages.pricing.subscribe'}</T>
          </button>
        </div>
      </div>
    </article>
  )
}
