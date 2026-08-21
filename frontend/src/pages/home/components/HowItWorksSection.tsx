import { T } from '@galalem/react-localization'

const STEPS = ['observe', 'experiment', 'evaluate'] as const

function ReflectionGlyph() {
  return (
    <svg width="46" height="30" viewBox="0 0 46 30" fill="none" aria-hidden="true">
      <circle cx="6" cy="8" r="3.4" fill="#F97316" />
      <line x1="6" y1="8" x2="23" y2="22" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="23" y1="22" x2="40" y2="8" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="40" cy="8" r="3.4" fill="#37C9B8" />
    </svg>
  )
}

export function HowItWorksSection() {
  return (
    <section id="how" className="how-section">
      <div className="text-center mx-auto" style={{ maxWidth: '36em', marginBottom: '40px' }}>
        <div className="section-eyebrow font-monospace">
          <T>pages.home.how_eyebrow</T>
        </div>
        <h2 className="section-heading m-0">
          <T>pages.home.how_heading</T>
        </h2>
        <p className="section-lede mx-auto">
          <T>pages.home.how_lede</T>
        </p>
      </div>
      <div className="how-grid">
        {STEPS.map((step, i) => (
          <article key={step}>
            <header>
              <span className="font-monospace">{`0${i + 1}`}</span>
              <ReflectionGlyph />
            </header>
            <h3>
              <T>{`pages.home.how_${step}_name`}</T>
            </h3>
            <p className="small">
              <T>{`pages.home.how_${step}_desc`}</T>
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
