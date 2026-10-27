/**
 * Registers the RecurBuy CartModel transformer on the cart drop-in.
 */

import { config as cartConfig } from '@dropins/storefront-cart/api.js';
import {
  DEFAULT_MINI_CART_MAX_ITEMS,
  composeCartModelPatches,
  transformCartModel,
} from '../cart-model-transformer.js';
import { patchModelHook } from './model-config-patch.js';

/**
 * @returns {number}
 */
function readMiniCartMaxItemsDisplay() {
  const raw = Number(cartConfig.getConfig()?.miniCartMaxItemsDisplay);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_MINI_CART_MAX_ITEMS;
}

/**
 * Compose with any prior CartModel.transformer; the host's own stays in the chain.
 *
 * @returns {() => void} dispose — restores the previous transformer
 */
export function installCartModelTransformer() {
  return patchModelHook(cartConfig, {
    model: 'CartModel',
    hook: 'transformer',
    create: (prior) => (cart) => {
      const base = prior ? prior(cart) : undefined;
      const patched = transformCartModel(cart, {
        miniCartMaxItemsDisplay: readMiniCartMaxItemsDisplay(),
      });
      return composeCartModelPatches(base, patched);
    },
  });
}
