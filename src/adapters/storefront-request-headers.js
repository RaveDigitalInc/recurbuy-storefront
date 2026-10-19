import { getShopperAuthToken } from '../auth.js';
import { getValidSubscriptionConfig } from '../config.js';

/**
 * Headers for RecurBuy storefront panel API.
 *
 * - {@code Authorization: Bearer} = connection {@code storefront_token} (pub/cur JWT)
 * - {@code X-RecurBuy-Customer-Token} = Magento shopper JWT (optional; omit for guest)
 * - {@code X-RecurBuy-Connection-Token} = same storefront token (labs / Resolve fallback)
 *
 * @param {{ includeShopper?: boolean, authToken?: string|null }} [options]
 * @returns {Record<string, string>}
 */
export function storefrontRequestHeaders(options = {}) {
  const config = getValidSubscriptionConfig();
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.connectionToken}`,
    'X-RecurBuy-Connection-Token': config.connectionToken,
  };

  if (options.includeShopper !== false) {
    const shopper = options.authToken || getShopperAuthToken();
    if (shopper) {
      headers['X-RecurBuy-Customer-Token'] = shopper;
    }
  }

  return headers;
}
