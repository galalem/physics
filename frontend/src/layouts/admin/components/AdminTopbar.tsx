import { useAdminChrome } from '../chrome'

export function AdminTopbar({ onToggleNav }: { onToggleNav: () => void }) {
  const { page, setActionHost } = useAdminChrome()

  return (
    <div className="admin-topbar">
      <button type="button" className="hamburger" onClick={onToggleNav} aria-label="Toggle navigation">
        <span />
        <span />
        <span />
      </button>

      <div className="titles">
        {page.crumb && <div className="crumb">{page.crumb}</div>}
        <h1>{page.title}</h1>
      </div>

      {/* Filled by <AdminActions> from the mounted page — see chrome.tsx. */}
      <div className="actions" ref={setActionHost} />
    </div>
  )
}
