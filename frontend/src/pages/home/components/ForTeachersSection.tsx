import { T } from '@galalem/react-localization'

export function ForTeachersSection() {
  return (
    <section id="teachers">
      <div>
        <svg viewBox="0 0 420 240" width="420" aria-hidden="true">
          <circle cx="40" cy="60" r="7" fill="#F97316" />
          <line x1="40" y1="60" x2="210" y2="170" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="210" y1="170" x2="380" y2="60" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="380" cy="60" r="7" fill="#37C9B8" />
        </svg>
        <div>
          <header className="font-monospace">
            <T>pages.home.teach_eyebrow</T>
          </header>
          <h2 className="section-heading m-0">
            <T>pages.home.teach_heading</T>
          </h2>
          <p>
            <T>pages.home.teach_body</T>
          </p>
          <div className="d-flex align-items-center flex-wrap" style={{ gap: '14px' }}>
            <button type="button" className="btn btn-primary rounded-pill" style={{ pointerEvents: 'none' }}>
              <T>pages.home.teach_cta</T>
            </button>
            <span className="font-monospace">
              <T>pages.home.teach_note</T>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
