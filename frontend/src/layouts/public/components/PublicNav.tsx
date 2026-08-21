import { T, useLocale } from '@galalem/react-localization'
import { Link, useRouter } from '@galalem/react-router'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LanguageSwitcher, Logo } from '~/components'
import { openSettings, useMe } from '~/hooks'

export function PublicNav() {
  const { __ } = useLocale()
  const router = useRouter()
  const { me, loading, logout } = useMe()

  const [open, setOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!userMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  const handleLogout = async () => {
    await logout()
    setUserMenuOpen(false)
    setOpen(false)
    router.push('/')
  }

  const initials = ((me?.firstName?.[0] ?? '') + (me?.lastName?.[0] ?? '')).toUpperCase();

  return (
    <header className={`public-nav${open ? ' is-open' : ''}`}>
      <div className="bar">
        <Logo />
        <nav className="links small">
          <a href="/#catalogue">
            <T>layouts.public.nav_catalogue</T>
          </a>
          <a href="/#how">
            <T>layouts.public.nav_how</T>
          </a>
          <Link to="/pricing">
            <T>layouts.public.nav_pricing</T>
          </Link>
        </nav>
        <div className="actions">
          <LanguageSwitcher />
          {loading ? null : me ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-pill"
                aria-label={__('layouts.public.user_menu')}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <span className="avatar" aria-hidden="true">{initials}</span>
                <span className="name">{me.firstName}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2 4l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); openSettings('profile'); }}
                  >
                    <T>layouts.public.settings</T>
                  </button>
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    <T>common.auth.logout</T>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="login small text-reset text-decoration-none">
                <T>common.auth.login</T>
              </Link>
              <Link to="/signup" className="signup btn btn-sm btn-primary rounded-pill lh-1">
                <T>common.auth.signup</T>
              </Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="burger"
          aria-label={__('layouts.public.nav_menu_open')}
          aria-expanded={open}
          aria-controls="public-nav-drawer"
          onClick={() => setOpen(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 6h18M3 12h18M3 18h18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {createPortal(
        <div className={`public-nav-offcanvas${open ? ' is-open' : ''}`}>
          <div className="backdrop" onClick={close} aria-hidden={!open} />
          <aside
            id="public-nav-drawer"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-hidden={!open}
          >
            <div className="drawer-head">
              <Logo />
              <button
                type="button"
                className="close"
                aria-label={__('layouts.public.nav_menu_close')}
                onClick={close}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <nav className="drawer-links" onClick={close}>
              <a href="/#catalogue">
                <T>layouts.public.nav_catalogue</T>
              </a>
              <a href="/#how">
                <T>layouts.public.nav_how</T>
              </a>
              <Link to="/pricing">
                <T>layouts.public.nav_pricing</T>
              </Link>
            </nav>
            <div className="drawer-foot">
              <LanguageSwitcher />
              {loading ? null : me ? (
                <div className="drawer-user">
                  <div className="user-card">
                    <span className="avatar" aria-hidden="true">{initials}</span>
                    <div className="who">
                      <div className="name">{me.fullName}</div>
                      <div className="email small text-muted">{me.email}</div>
                    </div>
                  </div>
                  <div className="drawer-user-actions">
                    <button
                      type="button"
                      className="btn btn-outline-secondary rounded-pill"
                      onClick={() => openSettings('profile')}
                    >
                      <T>layouts.public.settings</T>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary rounded-pill"
                      onClick={handleLogout}
                    >
                      <T>common.auth.logout</T>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="drawer-auth" onClick={close}>
                  <Link to="/login" className="btn btn-outline-secondary rounded-pill">
                    <T>common.auth.login</T>
                  </Link>
                  <Link to="/signup" className="btn btn-primary rounded-pill">
                    <T>common.auth.signup</T>
                  </Link>
                </div>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </header>
  )
}
