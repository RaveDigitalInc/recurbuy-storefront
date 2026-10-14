/**
 * Storefront install: wires RecurBuy into stock Adobe drop-ins through their
 * own extension points (FetchGraphQL hooks, event bus).
 */

import { installCartMutationHooks } from './cart-mutation-hooks.js';
import { autoMountProductDetails } from './pdp-auto-mount.js';
import { autoMountMiniPdp } from './mini-pdp-auto-mount.js';
import { installCartUiRuntime } from './cart-ui-runtime.js';

let installed = false;

/**
 * The only integration call a storefront needs. `init` places it in
 * `scripts/initializers/recurbuy.js`, loaded from the cart initializer.
 *
 * @param {{ cartClient: { addBeforeHook: Function, addAfterHook: Function } }} options
 *   `cartClient` is the FetchGraphQL instance passed to cart `setEndpoint`.
 */
export function installRecurBuyStorefront({ cartClient }) {
  if (installed) return;
  installed = true;

  installCartMutationHooks(cartClient);
  autoMountProductDetails();
  autoMountMiniPdp();
  installCartUiRuntime();
}
