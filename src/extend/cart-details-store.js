/**
 * Per-page state behind the cart UI runtime: RecurBuy subscription details by
 * cart-line uid, plus the panel checkout copy for the order summary.
 */

import { fetchCheckoutConfig } from '../adapters/storefront-checkout-config-adapter.js';
import { syncCartSubscriptionDetails } from '../cart-subscription-details.js';

/**
 * @param {{ getCartItems: () => Array<{ uid?: string }> }} options
 */
export function createCartDetailsStore({ getCartItems }) {
  /** @type {Map<string, import('../cart-subscription-details.js').CartSubscriptionDetails>} */
  const detailsByUid = new Map();

  /** @type {Record<string, unknown>|null} */
  let checkoutConfig = null;
  let checkoutConfigCartId = null;

  const refreshDetails = async (items) => {
    const list = items || getCartItems() || [];
    const next = await syncCartSubscriptionDetails(list, detailsByUid);

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
