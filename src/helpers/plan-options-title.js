/**
 * Resolve a merchant plan title from subscription-config {@code planOptions}.
 * Flat: `{ [optionId]: { title } }`.
 * Nested configurable: `{ [productId]: { [optionId]: { title } } }`.
 *
 * @param {unknown} planOptions
 * @param {string|number|null|undefined} optionId
 * @returns {string}
 */
export function titleFromPlanOptions(planOptions, optionId) {
  const key = String(optionId ?? '').trim();
  if (!key || key === '0' || !planOptions || typeof planOptions !== 'object') {
    return '';
  }

  const record = /** @type {Record<string, unknown>} */ (planOptions);
  const direct = readTitle(record[key]);
  if (direct) return direct;

  return Object.values(record)
    .map((bucket) => {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        return '';
      }
      const nested = /** @type {Record<string, unknown>} */ (bucket);
      // Flat option payloads have title/plan_id at this level — already handled by direct.
      if ('title' in nested && !Object.prototype.hasOwnProperty.call(nested, key)) {
        return '';
      }
      return readTitle(nested[key]);
    })
    .find((title) => title !== '') || '';
}

/**
 * @param {unknown} entry
 * @returns {string}
 */
function readTitle(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return '';
  }
  const { title } = /** @type {{ title?: unknown }} */ (entry);
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : '';
}
