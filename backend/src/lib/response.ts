import type { Context } from 'hono';

type OkStatus = 200 | 201;
type ErrStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 501;

interface ErrorLike {
  status: number;
  code: string;
  message: string;
  extras?: Record<string, unknown>;
}

export const responses = {
  content<T>(c: Context, data: T, status: OkStatus = 200) {
    return c.json({ status, content: data }, status);
  },

  mutation(c: Context, id: string, message: string, status: OkStatus = 200) {
    return c.json({ status, id, message }, status);
  },

  empty(c: Context, status: OkStatus = 200) {
    return c.json({ status, content: null }, status);
  },

  page<T>(c: Context, items: T[], page: number, size: number, totalElements: number) {
    const totalPages = totalElements === 0 ? 0 : Math.ceil(totalElements / size);
    return c.json(
      {
        status: 200,
        content: items,
        page,
        size,
        numberOfElements: items.length,
        totalElements,
        totalPages,
        first: page === 1,
        last: totalPages === 0 || page >= totalPages,
        empty: items.length === 0,
      },
      200,
    );
  },

  error(c: Context, err: ErrorLike) {
    return c.json(
      { status: err.status, error: { code: err.code, message: err.message, ...(err.extras ?? {}) } },
      err.status as ErrStatus,
    );
  },
};
