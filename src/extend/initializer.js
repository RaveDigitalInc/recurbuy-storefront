/**
 * Storefront install: wires RecurBuy into stock Adobe drop-ins through their
 * own extension points (FetchGraphQL hooks, event bus). RecurBuy is an add-on:
 * it acts only on RecurBuy selections and lines.
 */

import { events } from '@dropins/tools/event-bus.js';
import { refreshCart } from '@dropins/storefront-cart/api.js';
import { installCartLineOptionPdpHide } from '../helpers/cart-line-option.js';
import { prepareSubscriptionCartItem } from '../subscription-add-to-cart.js';
import { installCartModelTransformer } from './cart-model.js';
import { installCartUiRuntime } from './cart-ui-runtime.js';
import { autoMountMiniPdp } from './mini-pdp-auto-mount.js';
import { autoMountProductDetails } from './pdp-auto-mount.js';
import { createRecurbuyCart } from './recurbuy-cart.js';

/**
 * Entry-point guard against a host page importing this module twice; every
 * other piece of state lives in the instance.
 *
 * @type {ReturnType<typeof createRecurbuyCart>|null}
 */
let active = null;

/**
 * The only integration call a storefront needs. `init` places it in
 * `scripts/initializers/recurbuy.js`, loaded from the cart initializer.
 *
 * @param {{ cartClient: { addBeforeHook: Function, addAfterHook: Function } }} options
 *   `cartClient` is the FetchGraphQL instance passed to cart `setEndpoint`.
 * @returns {ReturnType<typeof createRecurbuyCart>} the installed instance
 *   (the existing one on repeated calls); `dispose()` switches it off.
 */
export function installRecurBuyStorefront({ cartClient }) {
  if (active) return active;

  const instance = createRecurbuyCart({
    client: cartClient,
    refreshCart,
    events,
    prepareCartItem: prepareSubscriptionCartItem,
    extensions: [
      () => installCartLineOptionPdpHide(),
      () => installCartModelTransformer(),
      ({ registerSelectionProvider }) => autoMountProductDetails({ registerSelectionProvider }),
      ({ registerSelectionProvider }) => autoMountMiniPdp({ registerSelectionProvider }),
      () => installCartUiRuntime(),
    ],
  });

  const handle = {
    ...instance,
    dispose() {
      instance.dispose();
      if (active === handle) active = null;
    },
  };
  active = handle;
  handle.install();
  return handle;
}
