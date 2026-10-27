/**
 * One RecurBuy add-on instance: owns the cart mutation hooks (selection
 * registry, finalizers, pending refresh) and every extension it installs.
 * Nothing here is module-level state, so two instances never interact.
 */

import { createCartMutationHooks } from './cart-mutation-hooks.js';

/**
 * @typedef {Object} RecurbuyCartApi
 * @property {(provider: import('./cart-mutation-hooks.js').CartSelectionProvider) => () => void}
 *   registerSelectionProvider returns an unregister function
 */

/**
 * @typedef {(api: RecurbuyCartApi) => (() => void)|void} RecurbuyExtension
 *   Installs one integration point and returns its disposer.
 */

/**
 * Collaborators are injected: the drop-in `refreshCart`, `events` bus and
 * `prepareCartItem` cannot be loaded outside a browser, so the storefront
 * entry point (`initializer.js`) supplies the real ones.
 *
 * @param {{
 *   client: { addBeforeHook: Function, addAfterHook: Function },
 *   refreshCart: () => Promise<unknown>,
 *   events: { on: Function },
 *   prepareCartItem: Function,
 *   extensions?: RecurbuyExtension[],
 * }} options
 */
export function createRecurbuyCart({
  client, refreshCart, events, prepareCartItem, extensions = [],
}) {
  const hooks = createCartMutationHooks({
    client, refreshCart, events, prepareCartItem,
  });
  const api = { registerSelectionProvider: hooks.registerSelectionProvider };

  /** @type {Array<() => void>} */
  const disposers = [];
  let installed = false;
  let disposed = false;

  return {
    ...api,

    /** Idempotent per instance; a disposed instance cannot be installed again. */
    install() {
      if (installed || disposed) return;
      installed = true;
      hooks.install();
      extensions.forEach((extension) => {
        // A failing extension (e.g. markup missing on this page) must not
        // break the host page or the remaining extensions.
        try {
          const dispose = extension(api);
          if (typeof dispose === 'function') disposers.push(dispose);
        } catch (error) {
          console.error('RecurBuy extension failed to install:', error);
        }
      });
    },

    /**
     * Turns already attached FetchGraphQL hooks into pass-throughs (they
     * cannot be removed) and undoes every extension in reverse order.
     */
    dispose() {
      if (disposed) return;
      disposed = true;
      hooks.dispose();
      while (disposers.length) {
        try {
          disposers.pop()();
        } catch (error) {
          console.warn('RecurBuy extension failed to dispose:', error);
        }
      }
    },
  };
}
