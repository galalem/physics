import { T } from '@galalem/react-localization'
import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'

/**
 * Route-level code splitting.
 *
 * `@galalem/react-router` renders `component` directly — it wraps nothing in
 * `<Suspense>` — so a bare `React.lazy` component would throw. This returns
 * a plain component that carries its own boundary, which satisfies the
 * router's `ComponentType` and keeps the split self-contained.
 *
 * Vite emits one chunk per `import()`, fetched only when the route actually
 * renders. Behind a `roles([...])` guard that means the bundle is never
 * downloaded by anyone who fails the guard.
 *
 * IMPORTANT: import the page module DIRECTLY, never through
 * `~/pages` — the barrel is imported eagerly by the router, so routing a
 * lazy page through it pulls the code back into the main bundle and
 * silently undoes the split.
 *
 *   lazyPage(() => import('~/pages/admin/page').then((m) => m.AdminPage))
 */
// NOTE: the return type is deliberately inferred, not annotated as
// `ComponentType`. `@galalem/react-router` is typed against
// `@types/react@18` while this app is on 19, and those two `ComponentType`
// declarations are not mutually assignable. A concrete function type
// satisfies both; the shared alias satisfies neither.
export function lazyPage(loader: () => Promise<ComponentType>) {
  const Lazy = lazy(() => loader().then((component) => ({ default: component })))
  return function LazyPage() {
    return (
      <Suspense fallback={<PageFallback />}>
        <Lazy />
      </Suspense>
    )
  }
}

function PageFallback() {
  return (
    <div className="page-loading d-flex justify-content-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">
          <T>common.literal.loading</T>
        </span>
      </div>
    </div>
  )
}

/**
 * Same idea for a layout, which must forward `children`.
 *
 * Without this the layout has to be imported eagerly to be named in the
 * route config, which makes its chunk a static dependency of the entry —
 * Vite then `modulepreload`s it and every guest downloads the admin shell.
 */
export function lazyLayout(loader: () => Promise<ComponentType<{ children: ReactNode }>>) {
  const Lazy = lazy(() => loader().then((component) => ({ default: component })))
  return function LazyLayout({ children }: { children: ReactNode }) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Lazy>{children}</Lazy>
      </Suspense>
    )
  }
}
