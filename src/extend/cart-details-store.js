/**
 * Per-page state behind the cart UI runtime: RecurBuy subscription details by
 * cart-line uid, plus the panel checkout copy for the order summary.
 */

import { getCartData } from '@dropins/storefront-cart/api.js';
import { fetchCheckoutConfig } from '../adapters/storefront-checkout-config-adapter.js';
import { nudgeQuantity } from '../cart-item-attributes.js';
import { syncCartSubscriptionDetails } from '../cart-subscription-details.js';

/**
 * @param {{ getCartItems: () => Array<{ uid?: string }> }} options
 */
export function createCartDetailsStore({ getCartItems }) {
  /** @type {Map<string, import('../cart-subscription-details.js').CartSubscriptionDetails>} */
  const detailsByUid = new Map();
  /** One attempt per uid: bundle lines whose GraphQL price still shows catalog/sale. */
  const bundleRepriceAttempted = new Set();

  /** @type {Record<string, unknown>|null} */
  let checkoutConfig = null;
  let checkoutConfigCartId = null;

  /**
   * Force AccS to re-save bundle selections when GraphQL still shows
   * catalog/sale while the stamped/synced plan unit is lower.
   * @returns {Promise<boolean>} true when a line was nudged
   */
  const repriceBundles = async (list, details) => {
    const cartId = (await getCartData())?.id;
    if (!cartId || typeof cartId !== 'string') return false;

    const targets = [...details.entries()].filter(([uid, entry]) => {
      if (bundleRepriceAttempted.has(uid)) return false;
      if (entry?.purchaseType !== 'subscription') return false;
      const planValue = entry.price?.value;
      if (!(typeof planValue === 'number' && planValue > 0)) return false;
      const item = list.find((line) => line?.uid === uid);
      if (!item || item.itemType !== 'BundleCartItem') return false;
      const magento = item.price?.value;
      return typeof magento === 'number' && magento > planValue * 1.15;
    });

    const results = await Promise.all(targets.map(async ([uid]) => {
      const item = list.find((line) => line?.uid === uid);
      if (!item) return false;
      bundleRepriceAttempted.add(uid);
      const qty = Number(item.quantity) || 1;
      try {
        await nudgeQuantity(cartId, uid, qty + 1);
        await nudgeQuantity(cartId, uid, qty);
        return true;
      } catch {
        // Display still uses the stamped/synced plan unit.
        return false;
      }
    }));
    return results.some(Boolean);
  };

  const refreshDetails = async (items) => {
    let list = items || getCartItems() || [];
    let next = await syncCartSubscriptionDetails(list, detailsByUid);

    if (await repriceBundles(list, next)) {
      list = getCartItems() || list;
      next = await syncCartSubscriptionDetails(list, detailsByUid);
    }

    detailsByUid.clear();
    next.forEach((details, uid) => detailsByUid.set(uid, details));
  };

  const refreshCheckoutConfig = async (cartData) => {
    const cartId = cartData?.id;
    if (!cartId || cartId === checkoutConfigCartId) return;
    checkoutConfigCartId = cartId;
    checkoutConfig = await fetchCheckoutConfig(cartId);
  };

  return {
    detailsByUid,
    getCheckoutConfig: () => checkoutConfig,
    /**
     * `cart/data` handler: failures are logged and never block painting.
     * @param {Object|null|undefined} cartData
     */
    async syncFromCartData(cartData) {
      try {
        await refreshDetails(cartData?.items);
      } catch (error) {
        console.error('Error syncing cart subscription details:', error);
      }
      try {
        await refreshCheckoutConfig(cartData);
      } catch (error) {
        console.error('Error refreshing RecurBuy checkout config:', error);
      }
    },
  };
}
