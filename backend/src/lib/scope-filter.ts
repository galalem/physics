// Evaluates an Odoo-style polish-notation scope filter against a tag set.
//
//   null / undefined / []         → matches everything
//   ["level:bac"]                  → single tag required
//   ["level:bac", "field:optics"]  → implicit AND across top-level operands
//   ["|", "level:bac", "level:2"]  → OR
//   ["&", "|", "a", "b", "c"]      → (a OR b) AND c
//
// Operators "&" and "|" are prefix and binary — each consumes the next
// two operands (which may themselves be operator sub-expressions).
// Anything malformed fails closed (returns false) rather than throwing.
export function matchesScope(filter: unknown, tags: Set<string>): boolean {
  if (filter === null || filter === undefined) return true;
  if (!Array.isArray(filter)) return false;
  if (filter.length === 0) return true;

  const pos = { i: 0 };
  let result = evalOne(filter, pos, tags);
  while (pos.i < filter.length) {
    const next = evalOne(filter, pos, tags);
    result = result && next;
  }
  return result;
}

function evalOne(arr: unknown[], pos: { i: number }, tags: Set<string>): boolean {
  const item = arr[pos.i++];
  if (item === '&') {
    const left = evalOne(arr, pos, tags);
    const right = evalOne(arr, pos, tags);
    return left && right;
  }
  if (item === '|') {
    const left = evalOne(arr, pos, tags);
    const right = evalOne(arr, pos, tags);
    return left || right;
  }
  if (typeof item === 'string') return tags.has(item);
  return false;
}
