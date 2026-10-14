import { getShopperAuthToken } from '../auth.js';
import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';

/**
 * Posts pending subscription add payload to the RecurBuy storefront checkout API.
 * Unlike GET adapters, this function DOES NOT swallow errors and throws on failure,
 * as the pending status is required for subscription pricing.
 *
 * @param {Object} params
 * @param {string} params.cartId Masked Commerce cart id
 * @param {string} params.sku Product SKU
 * @param {number|string} params.subscriptionOptionId Selected RecurBuy subscription option ID
 * @param {number|string} params.catalogProductId Catalog product ID
 * @param {string[]} [params.selectionSkus] Bundle child SKUs (price webhook seed)
 * @returns {Promise<Record<string, unknown>>} Response payload JSON
 */
export async function postPendingSubscriptionAdd({
  cartId,
  sku,
  subscriptionOptionId,
  catalogProductId,
  selectionSkus = null,
}) {
  const normalizedCartId = typeof cartId === 'string' ? cartId.trim() : '';
  if (!normalizedCartId || !sku || !subscriptionOptionId || !catalogProductId) {
    throw new Error('[RecurBuy] Missing required parameters for pending subscription add.');
  }

  // getValidSubscriptionConfig throws if config is invalid or missing required fields
  const config = getValidSubscriptionConfig();

  const url = new URL('/api/recurbuy/storefront/checkout/pending-subscription-add', config.storefrontUrl);

  const headers = {
    'Content-Type': 'application/json',
    'X-RecurBuy-Connection-Token': config.connectionToken,
  };

  const userToken = getShopperAuthToken();
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
  }

  /** @type {Record<string, unknown>} */
  const body = {
    cart_id: normalizedCartId,
    sku,
    subscription_option_id: subscriptionOptionId,
    catalog_product_id: catalogProductId,
  };
  if (Array.isArray(selectionSkus)) {
    const skus = selectionSkus
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry !== '');
    if (skus.length > 0) {
      body.selection_skus = skus;
    }
  }

  const controller = new AbortController();
  const timeoutMs = SUBSCRIPTION_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        errorDetails = await response.text();
      } catch {
        // Ignore text parsing errors
      }
      throw new Error(
        `[RecurBuy] Failed to register pending subscription add (${response.status}): ${errorDetails || response.statusText}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
