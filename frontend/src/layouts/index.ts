// NOTE: AdminLayout is deliberately NOT re-exported here. This barrel is
// imported eagerly by the router, so listing the admin layout would pull
// its chunk into the entry graph and Vite would modulepreload it — every
// guest downloading the admin shell. Import it directly from
// `~/layouts/admin/layout`, lazily. Same trap as `~/pages` for admin pages.
export { AuthLayout } from "./auth"
export { PublicLayout } from "./public"
