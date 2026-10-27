/**
 * AccS can answer a cart read with the catalog price while the RecurBuy plan
 * price is the real unit. One rule decides when the commerce value is stale.
 */

/** Commerce price above the plan price by more than this ratio is the catalog price. */
export const CATALOG_DRIFT_RATIO = 1.15;

/**
 * @param {unknown} observed Unit price Commerce returned.
 * @param {unknown} plan Unit price the plan stamped on the line.
 * @returns {boolean} true when `observed` is the catalog price, not the plan price.
 */
export function isCatalogDrift(observed, plan) {
  return typeof observed === 'number'
    && typeof plan === 'number'
    && plan > 0
    && observed > plan * CATALOG_DRIFT_RATIO;
}
