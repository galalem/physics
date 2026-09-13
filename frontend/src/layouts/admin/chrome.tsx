import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Admin chrome plumbing.
 *
 * The layout owns the top bar, but the breadcrumb, title and right-hand
 * action button belong to whichever page is mounted. `LayoutComponent` is
 * typed `ComponentType<{ children }>`, so the router cannot hand per-route
 * props to a layout — the page has to reach up.
 *
 * Two different mechanisms on purpose:
 *
 * - **Strings go through context.** `useAdminPage({ crumb, title })` sets
 *   them in an effect keyed on the strings themselves, so it settles in one
 *   pass and never loops.
 * - **Actions go through a portal.** An action is JSX carrying the page's
 *   own handlers; putting a node in layout state would re-run the effect on
 *   every render, since the element identity changes each time. Portalling
 *   leaves ownership (and reconciliation) with the page.
 */

type PageMeta = { crumb: string; title: string }

type AdminChromeValue = {
  page: PageMeta
  setPage: (meta: PageMeta) => void
  actionHost: HTMLElement | null
  setActionHost: (el: HTMLElement | null) => void
}

const AdminChromeContext = createContext<AdminChromeValue | null>(null)

export function AdminChromeProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageMeta>({ crumb: '', title: '' })
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)

  return (
    <AdminChromeContext.Provider value={{ page, setPage, actionHost, setActionHost }}>
      {children}
    </AdminChromeContext.Provider>
  )
}

function useAdminChrome(): AdminChromeValue {
  const ctx = useContext(AdminChromeContext)
  if (!ctx) throw new Error('Admin chrome used outside AdminLayout')
  return ctx
}

export { useAdminChrome }

/** Sets the top bar's breadcrumb + title. Call once per admin page. */
export function useAdminPage(crumb: string, title: string) {
  const { setPage } = useAdminChrome()
  useEffect(() => {
    setPage({ crumb, title })
  }, [crumb, title, setPage])
}

/**
 * Renders its children into the top bar's action slot. Handlers and state
 * stay in the page that wrote them.
 *
 *   <AdminActions>
 *     <button className="btn btn-primary" onClick={openInvite}>Invite user</button>
 *   </AdminActions>
 */
export function AdminActions({ children }: { children: ReactNode }) {
  const { actionHost } = useAdminChrome()
  if (!actionHost) return null
  return createPortal(children, actionHost)
}
