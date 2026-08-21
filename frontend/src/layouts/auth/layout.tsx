import type { ReactNode } from 'react'
import { AuthPanel } from './components/AuthPanel'
import { AuthTabs } from './components/AuthTabs'
import { LanguageSwitcher } from '~/components'
import './styles.scss'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-layout min-vh-100 d-grid" style={{gridTemplateColumns: "1fr 1fr"}}>
      <AuthPanel />
      <section className="auth-layout__form-panel">
        <div className="d-flex justify-content-end">
          <LanguageSwitcher />
        </div>
        <div className="m-auto w-100" style={{maxWidth: '380px'}}>
          <AuthTabs />
          {children}
        </div>
      </section>
    </div>
  )
}
