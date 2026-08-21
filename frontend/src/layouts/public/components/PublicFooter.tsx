import { T, useLocale } from '@galalem/react-localization'
import { Link } from '@galalem/react-router'

export function PublicFooter() {
  const { __ } = useLocale()
  const year = new Date().getFullYear()

  return (
    <footer className="public-footer">
      <div className="inner">
        <div className="copyright">
          {__('layouts.public.footer_copyright').replace('{year}', String(year))}
        </div>
        <div className="tag">
          <T>layouts.public.footer_tag</T>
        </div>
        <div className="links">
          <Link to="/privacy" className="text-reset">
            <T>layouts.public.footer_privacy</T>
          </Link>
          <span className="dot" aria-hidden="true">·</span>
          <Link to="/terms" className="text-reset">
            <T>layouts.public.footer_terms</T>
          </Link>
        </div>
      </div>
    </footer>
  )
}
