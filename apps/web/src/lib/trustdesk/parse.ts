/**
 * The Databricks SQL Statement API (JSON_ARRAY format) returns ALL values as strings,
 * including booleans — `true` comes back as the string `"true"` and `false` as `"false"`.
 * `Boolean(value)` is truthy for any non-empty string, so `Boolean("false")` is `true`,
 * silently flipping ungrounded evidence to "grounded". Use this helper instead of the
 * `Boolean()` constructor whenever coercing a Databricks boolean-typed column.
 *
 * Returns `true` only for the boolean `true`, the number `1`, or the strings
 * `'true'`, `'t'`, `'1'` (case-insensitive). Everything else — including `undefined`,
 * `null`, `false`, `0`, `'false'`, `'0'`, and any other value — returns `false`.
 */
export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    return normalized === 'true' || normalized === 't' || normalized === '1';
  }
  return false;
}
