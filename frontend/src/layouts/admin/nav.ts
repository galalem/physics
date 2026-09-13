/**
 * Admin navigation. Grouped from day one because the console reaches nine
 * areas — three of them not built yet, shown dimmed so the shell is
 * designed once rather than retrofitted.
 */
export type AdminNavItem = {
  label: string
  path: string
  /** Not built yet: rendered dimmed, routes to a "planned" panel. */
  planned?: boolean
}

export type AdminNavGroup = { label: string; items: AdminNavItem[] }

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/admin' }],
  },
  {
    label: 'Users',
    items: [
      { label: 'Users', path: '/admin/users' },
      { label: 'Teachers', path: '/admin/teachers', planned: true },
      { label: 'Experts', path: '/admin/experts', planned: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Exercises', path: '/admin/exercises' },
      { label: 'Tags', path: '/admin/tags' },
    ],
  },
  {
    label: 'Monetization',
    items: [
      { label: 'Entitlements', path: '/admin/entitlements' },
      { label: 'Promo codes', path: '/admin/promo-codes' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Attempts', path: '/admin/attempts' },
      { label: 'Feedback', path: '/admin/feedback', planned: true },
    ],
  },
]
