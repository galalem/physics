import { init } from '@galalem/react-localization'
import { RouterProvider } from '@galalem/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './bootstrap.scss'
import { LocaleSync } from './lib/locale-sync'
import { router } from './router'

init()

await router.ready

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleSync />
    <RouterProvider router={router} />
  </StrictMode>,
)

document.getElementById('preloader')?.remove()
