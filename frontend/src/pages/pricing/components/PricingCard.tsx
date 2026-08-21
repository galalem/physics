import { T, useLocale } from '@galalem/react-localization'
import { computePriceTND, formatTND, type PresetTier } from '../pricing'

interface Props {
  tier: PresetTier
  onSubscribe: () => void
  busy?: boolean
}

export function PricingCard({ tier, onSubscribe, busy }: Props) {
  const { __ } = useLocale()
  const price = computePriceTND(tier.days)
  return (
    <article className={`pricing-card ${tier.popular ? 'popular' : ''}`}>
      {tier.popular && <div className="popular-tag"><T>pages.pricing.popular_tag</T></div>}
      <header>
        <div className="label"><T>{tier.labelKey}</T></div>
        <div className="tagline"><T>{tier.taglineKey}</T></div>
      </header>
      <div className="price">
        <span className="amount">{formatTND(price)}</span>
        <span className="period">{__('pages.pricing.period').replace('{n}', String(tier.days))}</span>
      </div>
      <ul>
        {tier.bulletKeys.map((k) => (
          <li key={k}>
            <i className="bi bi-check2" aria-hidden="true" />
            <span><T>{k}</T></span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`btn rounded-pill w-100 ${tier.popular ? 'btn-primary' : 'btn-outline-dark'}`}
        onClick={onSubscribe}
        disabled={busy}
      >
        <T>{busy ? 'pages.pricing.redirecting' : 'pages.pricing.subscribe'}</T>
      </button>
    </article>
  )
}
