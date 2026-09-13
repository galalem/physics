import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { useEffect, useRef, useState } from 'react'
import { useMe } from '~/hooks'

/**
 * Sidebar footer account menu. Mirrors PublicNav's user pill — same
 * avatar/name/chevron shape, same outside-click and Escape handling — so
 * the two surfaces behave identically, just retinted for the navy rail.
 *
 * Opens upward: it sits at the bottom of the sidebar.
 */
export function AdminUserMenu() {
  const { __ } = useLocale()
  const router = useRouter()
  const { me, logout } = useMe()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!me) return null

  const initials = ((me.firstName?.[0] ?? '') + (me.lastName?.[0] ?? '')).toUpperCase()

  const handleLogout = async () => {
    await logout()
    setOpen(false)
    router.push('/')
  }

  return (
    <div className="admin-user" ref={ref}>
      <button
        type="button"
        className="user-pill"
        aria-label={__('layouts.public.user_menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="who">
          <span className="name">{me.firstName}</span>
          <span className="role">{me.role}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="admin-user-menu" role="menu">
          {/*
            Settings is a modal mounted in PublicLayout and deep-linked by
            `?settings=`. It cannot render inside the admin shell, so open
            it in a new tab rather than throwing away the admin context.
          */}
          <a
            href="/?settings=profile"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <T>layouts.public.settings</T>
            <span className="ext" aria-hidden="true">↗</span>
          </a>
          <Link to="/" role="menuitem" onClick={() => setOpen(false)}>
            Back to the app
          </Link>
          <button type="button" role="menuitem" onClick={handleLogout}>
            <T>common.auth.logout</T>
          </button>
        </div>
      )}
    </div>
  )
}
