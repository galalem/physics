import { T, useLocale } from '@galalem/react-localization'
import { useRouter } from '@galalem/react-router'
import { useState } from 'react'
import { useDocumentHead } from '~/hooks'
import { useMe } from '~/hooks/useMe'
import { checkout } from '~/lib/checkout'
import { BacCta } from './components/BacCta'
import { CustomPlanCard } from './components/CustomPlanCard'
import { PricingCard } from './components/PricingCard'
import { daysFromNowToISO, PRESETS } from './pricing'
import './styles.scss'

const BAC_PROMO_CODE = 'BAC2027'

export function PricingPage() {
  const { __ } = useLocale()
  const router = useRouter()
  const { me, loading } = useMe()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useDocumentHead({
    title: __('seo.pricing.title'),
    description: __('seo.pricing.description'),
    path: '/pricing',
  })

  async function startCheckout(
    days: number,
    key: string,
    title: string,
    opts: { scope_filter?: { tags: string[] } | null; promo_code?: string | null } = {},
  ) {
    if (loading) return
    if (!me) {
      router.redirect('/login?redirectUrl=/pricing')
      return
    }
    setBusyKey(key)
    setError(null)
    const origin = window.location.origin
    const description = __('pages.pricing.checkout_description').replace('{n}', String(days))
    const res = await checkout.start({
      validity_until: daysFromNowToISO(days),
      scope_filter: opts.scope_filter ?? null,
      promo_code: opts.promo_code ?? null,
      success_url: `${origin}/checkout/success?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
      title,
      description,
      image_url: `${origin}/brand/logo-email.png`,
    })
    if (res.error) {
      setBusyKey(null)
      setError(res.error.message || __('pages.pricing.error_generic'))
      return
    }
    window.location.href = res.content.redirect_url
  }

  function startBacCheckout(specialty: string, days: number, year: number) {
    const title = `${__('pages.pricing.bac_title_prefix')} ${year}`
    startCheckout(days, 'bac', title, {
      scope_filter: { tags: [specialty] },
      promo_code: BAC_PROMO_CODE,
    })
  }

  return (
    <div className="pricing-page">
      <header>
        <div className="eyebrow"><T>pages.pricing.eyebrow</T></div>
        <h1><T>pages.pricing.title</T></h1>
        <p className="lede"><T>pages.pricing.lede</T></p>
      </header>

      {error && <div className="alert alert-danger error">{error}</div>}

      <div className="pricing-grid">
        {PRESETS.map((tier) => (
          <PricingCard
            key={tier.key}
            tier={tier}
            busy={busyKey === tier.key}
            onSubscribe={() => startCheckout(tier.days, tier.key, __(tier.labelKey))}
          />
        ))}
        <CustomPlanCard
          busy={busyKey === 'custom'}
          onSubscribe={(days) => startCheckout(days, 'custom', __('pages.pricing.tier_custom_label'))}
        />
      </div>

      <BacCta
        busy={busyKey === 'bac'}
        onSubscribeBac={startBacCheckout}
      />
    </div>
  )
}
