import { refreshCart } from '@dropins/storefront-cart/api.js';
import { repriceBundleLineQuantity } from './cart-item-attributes.js';

/** Uids already scheduled this page load. */
const scheduled = new Set();

/**
 * Unit Magento showed for this line. Accepts the drop-in cart and the raw
 * addProductsToCart payload.
 *
 * @param {Object|null|undefined} cart
 * @param {string} itemUid
 * @returns {number|null} null when the line is not a bundle
 */
export function bundleLineCatalogUnit(cart, itemUid) {
  const items = cart?.items || cart?.itemsV2?.items || [];
  if (!Array.isArray(items)) return null;

  const line = items.find((entry) => entry?.uid === itemUid);
  if (!line) return null;

  const type = line.itemType || line.__typename;
  if (type !== 'BundleCartItem') return null;

  const direct = line.price?.value;
  if (typeof direct === 'number') return direct;

  const nested = line.prices?.price?.value;
  return typeof nested === 'number' ? nested : null;
}

/**
 * When a dynamic bundle is still at the catalog child-sum, re-save it after
 * add-to-cart has already returned. Does not read the cart again.
 *
 * @param {{
 *   cartId: string,
 *   itemUid: string,
 *   quantity: number,
 *   planUnitValue: number,
 *   magentoUnit: number|null,
 * }} input
 */
export function scheduleBundleCatalogReprice(input) {
  const {
    cartId,
    itemUid,
    quantity,
    planUnitValue,
    magentoUnit,
  } = input;

  if (!cartId || !itemUid || scheduled.has(itemUid)) return;
  if (!(typeof planUnitValue === 'number' && planUnitValue > 0)) return;
  if (!(typeof magentoUnit === 'number' && magentoUnit > planUnitValue * 1.15)) return;

  scheduled.add(itemUid);
  const qty = Number(quantity) > 0 ? Number(quantity) : 1;

  repriceBundleLineQuantity(cartId, itemUid, qty)
    .then(() => refreshCart?.())
    .catch(() => {
      scheduled.delete(itemUid);
    });
}
