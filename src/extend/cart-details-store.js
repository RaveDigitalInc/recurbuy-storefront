/**
 * Per-page state behind the cart UI runtime: RecurBuy subscription details by
 * cart-line uid, plus the panel checkout copy for the order summary.
 */

import { fetchCheckoutConfig } from '../adapters/storefront-checkout-config-adapter.js';
import { scheduleBundleCatalogReprice } from '../bundle-reprice.js';
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
   * Schedule a background bundle re-save when this cart payload still shows
   * the catalog child-sum. Painting does not wait for it.
   * @param {Array<{ uid?: string, quantity?: number, price?: { value?: number } }>} list
   * @param {Map<string, { purchaseType?: string, price?: { value?: number } }>} details
   * @param {string|null|undefined} cartId
   */
  const repriceBundles = (list, details, cartId) => {
    if (!cartId) return;

    details.forEach((entry, uid) => {
      if (bundleRepriceAttempted.has(uid)) return;
      if (entry?.purchaseType !== 'subscription') return;
      const planValue = entry.price?.value;
      if (!(typeof planValue === 'number' && planValue > 0)) return;
      const item = list.find((line) => line?.uid === uid);
      if (!item || item.itemType !== 'BundleCartItem') return;
      const magento = item.price?.value;
      if (!(typeof magento === 'number' && magento > planValue * 1.15)) return;

      bundleRepriceAttempted.add(uid);
      scheduleBundleCatalogReprice({
        cartId,
        itemUid: uid,
        quantity: Number(item.quantity) || 1,
        planUnitValue: planValue,
        magentoUnit: magento,
      });
    });
  };

  const refreshDetails = async (items, cartId) => {
    const list = items || getCartItems() || [];
    const next = await syncCartSubscriptionDetails(list, detailsByUid);
    repriceBundles(list, next, cartId);

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
        await refreshDetails(cartData?.items, cartData?.id);
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
