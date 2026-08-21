import type { ReactNode } from 'react'
import { SettingsModal } from '~/pages/settings'
import { PublicFooter } from './components/PublicFooter'
import { PublicNav } from './components/PublicNav'
import './styles.scss'

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-layout min-vh-100 d-flex flex-column">
      <PublicNav />
      <main className="flex-grow-1">{children}</main>
      <PublicFooter />
      <SettingsModal />
    </div>
  )
}
