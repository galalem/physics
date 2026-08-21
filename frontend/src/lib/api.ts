/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type ApiError = {
  code: string
  message: string
} & Record<string, any>

export interface Response {
  status: number
  error?: ApiError
}

export interface ContentResponse<T> extends Response {
  content: T
}

export interface PaginatedResponse<T> extends ContentResponse<T[]> {
  page: number
  size: number
  numberOfElements: number
  totalElements: number
  totalPages: number
  first: boolean
  last: boolean
  empty: boolean
}

export interface MutationResponse extends Response {
  id: string
  message: string
}

type HttpConfig = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  params?: Record<string, string | string[] | undefined>
  body?: unknown
  headers?: HeadersInit
  // Pass through to fetch — keeps the request alive across document unload
  // (tab close, nav). Same-origin, POST/PATCH, small body only. Used by
  // fire-and-forget "final" writes like attempt.complete + save-state.
  keepalive?: boolean|undefined
}

type PostOpts = { keepalive?: boolean }

async function request(path: string, config?: HttpConfig): Promise<Response> {
  const url = new URL('/api/v1' + (path.startsWith('/') ? '' : '/') + path, window.location.origin)
  const locale = document.documentElement.lang || 'en'

  if (config?.params) {
    for (const [key, value] of Object.entries(config.params)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v)
      } else {
        url.searchParams.set(key, value)
      }
    }
  }

  const hasBody = config?.body !== undefined

  let res: globalThis.Response
  try {
    res = await fetch(url, {
      method: config?.method || 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept-Language': locale,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...config?.headers,
      },
      body: hasBody ? JSON.stringify(config!.body) : null,
      ...(config?.keepalive ? { keepalive: true } : {}),
    })
  } catch {
    return { status: 0, error: { code: 'network_error', message: 'Network error' } }
  }

  try {
    return await (res.json() as Promise<Response>)
  } catch {
    return { status: res.status, error: { code: 'unknown', message: `HTTP ${res.status}` } }
  }
}

export const http = {
  get(path: string, params?: Record<string, string | string[] | undefined>): Promise<Response> {
    return request(path, { method: 'GET', params: params || {} })
  },
  post(path: string, body?: unknown, opts?: PostOpts): Promise<Response> {
    return request(path, { method: 'POST', body, keepalive: opts?.keepalive })
  },
  patch(path: string, body?: unknown, opts?: PostOpts): Promise<Response> {
    return request(path, { method: 'PATCH', body, keepalive: opts?.keepalive })
  },
  delete(path: string, body?: unknown): Promise<Response> {
    return request(path, { method: 'DELETE', body })
  },
}

export const bread = {
  browse: function <T>(path: string, page: number, size: number, filters?: Record<string, string | string[] | undefined>) {
    return http.get(path, {
      page: `${page}`,
      size: `${size}`,
      ...filters
    }) as Promise<PaginatedResponse<T>>
  },
  read: function <T>(path: string, id: string, params?: Record<string, string | string[] | undefined>) {
    return http.get(path + "/" + id, params) as Promise<ContentResponse<T>>
  }
}
