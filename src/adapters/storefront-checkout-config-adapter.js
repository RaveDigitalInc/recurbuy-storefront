import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';
import { mapStorefrontCheckoutConfigPayload } from './storefront-checkout-config-mapper.js';

/**
 * Fetches mixed-cart checkout flags from the RecurBuy storefront API.
 * Soft-fails: returns null on missing config, network errors, or non-OK responses.
 *
 * @param {string|undefined|null} cartId Guest mask or numeric Commerce cart id
 * @returns {Promise<import('./storefront-checkout-config-mapper.js')
 *   .StorefrontCheckoutConfig|null>}
 */
export async function fetchCheckoutConfig(cartId) {
  const normalizedCartId = typeof cartId === 'string' ? cartId.trim() : '';
  if (!normalizedCartId) {
    return null;
  }

  let config;
  try {
    config = getValidSubscriptionConfig();
  } catch {
    return null;
  }

  const url = new URL('/api/recurbuy/storefront/checkout/config', config.storefrontUrl);
  url.searchParams.set('cart_id', normalizedCartId);

  const controller = new AbortController();
  const timeoutMs = SUBSCRIPTION_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'X-RecurBuy-Connection-Token': config.connectionToken,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return mapStorefrontCheckoutConfigPayload(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
