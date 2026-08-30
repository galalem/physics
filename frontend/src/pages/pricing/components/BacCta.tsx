import { T, useLocale } from '@galalem/react-localization'
import { useId, useState } from 'react'
import { computePriceTND, formatTND } from '../pricing'
import { useTags } from '~/hooks';

// Days until the Tunisian Baccalaureate — first Wednesday of June, pinned
// per session because the date shifts year to year. Once the session opens
// the countdown hits 0 and the whole CTA unmounts, so the checkout call can
// never fall under the backend's MIN_VALIDITY (24h) window.
function daysUntilBac(): { days: number; year: number } {
  const now = new Date().getTime();
  const bac = new Date(Date.UTC(2027, 5, 2)).getTime(); // TODO replace this date each year
  const daysToBac = Math.max(0, Math.round((bac - now) / 86_400_000));
  return { days: daysToBac, year: 2027 }
}

const SPECIALTIES = [
  'level:bac-maths',
  'level:bac-sciexp',
  'level:bac-tech',
  'level:bac-info',
];

interface Props {
  onSubscribeBac: (specialty: string, days: number, year: number) => void
  busy?: boolean
}

export function BacCta({ onSubscribeBac, busy }: Props) {
  const { __ } = useLocale()
  const { labelTag } = useTags()
  const { days, year } = daysUntilBac()
  const [specialty, setSpecialty] = useState<string>('')
  const selectId = useId()

  if (days <= 0)
    return null;

  const fullPrice = computePriceTND(days)
  const discountedPrice = Math.ceil(fullPrice * 0.5)

  return (
    <section className="bac-cta">
      <div className="bg" aria-hidden="true">
        <svg viewBox="0 0 800 400" preserveAspectRatio="none">
          <defs>
            <linearGradient id="bacg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="60%" stopColor="#ea580c" />
              <stop offset="100%" stopColor="#7c2d12" />
            </linearGradient>
            <pattern id="bacgrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0 L0 0 0 32" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="800" height="400" fill="url(#bacg)" />
          <rect width="800" height="400" fill="url(#bacgrid)" />
          <g opacity="0.35" stroke="#ffe0b3" strokeWidth="1.5" fill="none">
            <path d="M0 260 Q 200 200, 400 260 T 800 260" />
            <path d="M0 300 Q 200 240, 400 300 T 800 300" />
            <path d="M0 340 Q 200 280, 400 340 T 800 340" />
          </g>
          <g fill="#ffe0b3" opacity="0.6">
            <circle cx="120" cy="90" r="3" />
            <circle cx="640" cy="70" r="4" />
            <circle cx="700" cy="140" r="2.5" />
            <circle cx="80" cy="170" r="2" />
            <circle cx="560" cy="200" r="3.5" />
          </g>
        </svg>
      </div>

      <div className="content">
        <div className="left">
          <div className="countdown">
            <span className="n">{days}</span>
            <span className="l"><T>pages.pricing.bac_countdown</T></span>
          </div>
          <h2 className="title">
            <T>pages.pricing.bac_title_prefix</T> <span>{year}</span>
          </h2>
          <p className="body">
            <T>pages.pricing.bac_body</T>
          </p>

          <div className="specialty-picker">
            <label htmlFor={selectId}><T>pages.pricing.bac_specialty_legend</T></label>
            <select
              id={selectId}
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              disabled={busy}
            >
              <option value="" disabled>{__('pages.pricing.bac_specialty_placeholder')}</option>
              {SPECIALTIES.map((tag) => (
                <option key={tag} value={tag}>{labelTag(tag)}</option>
              ))}
            </select>
          </div>

          <div className="pricing-strip" dir="ltr">
            <span className="strike">{formatTND(fullPrice)}</span>
            <span className="new">{formatTND(discountedPrice)}</span>
            <span className="unit"><T>pages.pricing.bac_price_unit</T></span>
          </div>

          <div className="actions">
            <button
              type="button"
              className="btn btn-light rounded-pill"
              onClick={() => specialty && onSubscribeBac(specialty, days, year)}
              disabled={busy || !specialty}
            >
              <T>{busy ? 'pages.pricing.redirecting' : 'pages.pricing.bac_cta'}</T>
            </button>
            <span className="note"><T>pages.pricing.bac_note</T></span>
          </div>
        </div>

        <div className="right" aria-hidden="true">
          <svg viewBox="-40 -140 300 500" width="300" height="500">
            <g fill="none" stroke="#ffe0b3" strokeWidth="1.6">
              <circle cx="110" cy="110" r="94" opacity="0.35" />
              <circle cx="110" cy="110" r="68" opacity="0.55" />
              <circle cx="110" cy="110" r="42" opacity="0.85" />
            </g>
            <text
              x="110"
              y="32"
              textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize="128"
              fontWeight="900"
              letterSpacing="-3"
              fill="#ffe0b3"
              opacity="0.22"
              transform="rotate(-20)"
            >
              {__('pages.pricing.bac_discount_stamp')}
            </text>
            <g fill="#ffe0b3">
              <circle cx="110" cy="16" r="4" />
              <circle cx="204" cy="110" r="4" />
              <circle cx="110" cy="204" r="4" />
              <circle cx="16" cy="110" r="4" />
            </g>
            <g stroke="#fff" strokeWidth="2" fill="none">
              <path d="M70 110 L100 138 L155 82" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
        </div>
      </div>
    </section>
  )
}
