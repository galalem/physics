import { Link, useRouter } from '@galalem/react-router'
import { ADMIN_NAV } from '../nav'
import { AdminUserMenu } from './AdminUserMenu'

interface Props {
  onClose: () => void
}

export function AdminSidebar({ onClose }: Props) {
  const { path } = useRouter()

  return (
    <aside className="admin-sidebar">
      <div className="brand">
        <span className="wordmark" dir="ltr">
          <svg viewBox="45 14 90 152" width="14" height="24" fill="none" aria-hidden="true">
            <path
              d="m82.5945 133.4772v-16.512q-17.3397 0-27.0933-9.7536-9.7536-9.9342-9.7536-26.7321v-33.9569q0-13.3661 8.4892-21.1328 8.3086-7.7667 22.7584-7.7667v12.6437q-7.5861 0-11.921 4.3349-4.3349 4.3349-4.3349 11.921v33.9569q0 11.0179 5.9605 17.3397 5.9605 6.3218 16.7978 6.3218v-86.5179h19.5072q14.4498 0 22.7584 7.7667 8.4892 7.7667 8.4892 21.1328v33.9569q0 16.7978-9.7536 26.7321-9.7536 9.7536-27.0933 9.7536v16.512q0 13.3661-8.4892 21.1328-8.3086 7.7667-22.7584 7.7667v-12.6437q7.5861 0 11.921-4.3349 4.5156-4.3349 4.5156-11.921zm13.9079-29.3361q10.6567 0 16.6172-6.3218 6.1411-6.3218 6.1411-17.3397v-33.9569q0-7.5861-4.3349-11.921-4.3349-4.3349-11.921-4.3349h-6.5024z"
              fill="currentColor"
            />
          </svg>
          <span className="word">ysics</span>
        </span>
        <span className="tag">admin</span>
        <button type="button" className="close" onClick={onClose} aria-label="Close navigation">
          ✕
        </button>
      </div>

      <nav>
        {ADMIN_NAV.map((group) => (
          <div className="group" key={group.label}>
            <div className="group-label">{group.label}</div>
            {group.items.map((item) => {
              // `/admin` would otherwise match every child route.
              const active = item.path === '/admin' ? path === '/admin' : path.startsWith(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`item${active ? ' is-active' : ''}${item.planned ? ' is-planned' : ''}`}
                >
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <AdminUserMenu />
    </aside>
  )
}
