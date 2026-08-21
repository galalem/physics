import { T } from '@galalem/react-localization'

export function SupportSection() {
  return (
    <section className="settings-section">
      <header>
        <h2><T>pages.settings.support.title</T></h2>
        <p><T>pages.settings.support.description</T></p>
      </header>

      <div className="support-card">
        <div className="icon" aria-hidden="true">
          <i className="bi bi-envelope-heart" />
        </div>
        <div className="body">
          <h3><T>pages.settings.support.email_title</T></h3>
          <p>
            <T>pages.settings.support.email_body_before</T>{' '}
            <a href="mailto:support@physics.galalem.tn">support@physics.galalem.tn</a>{' '}
            <T>pages.settings.support.email_body_after</T>
          </p>
        </div>
      </div>
    </section>
  )
}
