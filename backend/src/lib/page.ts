export function parsePagination(query: Record<string, string | undefined>): { page: number; size: number } {
  const hasPage = query.page !== undefined;
  const hasSize = query.size !== undefined;
  const size = hasSize ? Math.min(Math.max(parseInt(query.size!, 10) || 20, 1), 100) : 20;
  const pageNum = hasPage ? Math.max(parseInt(query.page!, 10) || 1, 1) : 1;
  return { page: pageNum, size };
}
