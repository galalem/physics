import { http, type ContentResponse } from './api'

export interface CheckoutStartParams {
  validity_until: string
  scope_filter?: { tags: string[] } | null
  promo_code?: string | null
  success_url: string
  cancel_url: string
  locale?: 'ar' | 'fr' | 'en'
  title: string
  description?: string
  image_url?: string
}

export interface CheckoutStartResult {
  redirect_url: string
}

export const checkout = {
  start(params: CheckoutStartParams) {
    return http.post('/checkout/start', params) as Promise<ContentResponse<CheckoutStartResult>>
  },
}
