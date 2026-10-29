/**
 * Registers the RecurBuy CartModel transformer on the cart drop-in.
 *
 * Cart `initialize()` calls `config.setConfig({…})` with a fresh object that
 * does not keep prior `models` — so a transformer installed before initialize
 * is wiped, and the first quote map (and MiniCart after F5) never gets
 * `item.recurbuy` from GraphQL `custom_attributes`. Re-apply inside a
 * `setConfig` wrapper so the same initialize/refresh fetch maps with our
 * transformer (quote SoR). Also re-apply on `cart/initialized` as a safety net.
 */

import { events } from '@dropins/tools/event-bus.js';
import { config as cartConfig } from '@dropins/storefront-cart/api.js';
import {
  DEFAULT_MINI_CART_MAX_ITEMS,
  composeCartModelPatches,
  transformCartModel,
} from '../cart-model-transformer.js';
import { keepModelHookAcrossSetConfig } from './model-hook-keep.js';
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
 * @returns {() => void}
 */
function attachTransformer() {
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

/**
 * @param {{ getConfig: () => any }} [configApi]
 * @returns {boolean}
 */
export function hasCartModelTransformer(configApi = cartConfig) {
  return typeof configApi.getConfig()?.models?.CartModel?.transformer === 'function';
}

/**
 * Compose with any prior CartModel.transformer; the host's own stays in the chain.
 *
 * @returns {() => void} dispose — restores the previous transformer / setConfig
 */
export function installCartModelTransformer() {
  return keepModelHookAcrossSetConfig(cartConfig, {
    attach: attachTransformer,
    hasHook: () => hasCartModelTransformer(cartConfig),
    on: (name, handler, opts) => events.on(name, handler, opts),
  });
}
