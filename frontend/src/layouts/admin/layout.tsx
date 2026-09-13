import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from '@galalem/react-router'
import { AdminChromeProvider } from './chrome'
import { AdminSidebar } from './components/AdminSidebar'
import { AdminTopbar } from './components/AdminTopbar'
import './styles.scss'

/**
 * Admin console shell: sidebar + sticky top bar.
 *
 * The top bar lives here rather than in each page, so pages hand it their
 * breadcrumb/title through `useAdminPage()` and their right-hand button
 * through `<AdminActions>`. See `chrome.tsx` for why those use two
 * different mechanisms.
 *
 * `is-nav-open` always means "the sidebar is visible". What that costs is
 * decided in CSS: on desktop the sidebar is a grid column that disappears
 * when closed, on mobile it is an overlay drawer. The only JS reading the
 * viewport is the initial default (open on desktop, closed on mobile) and
 * the mobile-only auto-close below — the prototype's continuous
 * `innerWidth` tracking was a constraint of its inline-styles runtime, not
 * a design decision.
 */
const MOBILE = '(max-width: 899.98px)'

const isMobile = () => typeof window !== 'undefined' && window.matchMedia(MOBILE).matches

export function AdminLayout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(() => !isMobile())
  const { path } = useRouter()

  // Mobile only: the drawer overlays the page, so leaving it open across a
  // navigation would cover the page the user just asked for. On desktop
  // the sidebar is persistent chrome and must survive navigation.
  useEffect(() => {
    if (isMobile()) setNavOpen(false)
  }, [path])

  return (
    <AdminChromeProvider>
      <div className={`admin-layout${navOpen ? ' is-nav-open' : ''}`}>
        <div className="admin-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

        <AdminSidebar onClose={() => setNavOpen(false)} />

        <main className="admin-main">
          <AdminTopbar onToggleNav={() => setNavOpen((v) => !v)} />
          <div className="admin-content">{children}</div>
        </main>
      </div>
    </AdminChromeProvider>
  )
}
