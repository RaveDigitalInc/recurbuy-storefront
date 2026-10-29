/**
 * Subscription add-to-cart through Adobe FetchGraphQL hooks.
 * Stock blocks keep calling `addProductsToCart`; after a successful add the
 * hook stamps custom attributes on the new line.
 *
 * Add-on contract: both hooks are pure pass-throughs unless a registered
 * RecurBuy selection (purchaseType `subscription`) is part of the request.
 * All state lives in the instance returned by `createCartMutationHooks`.
 */

import { normalizeGraphqlCartData } from '../cart-raw-normalizer.js';

const ADD_OPERATION = 'ADD_PRODUCTS_TO_CART_MUTATION';

/**
 * Carries pending finalize work on the FetchGraphQL requestInit object so an
 * after-hook still finds it when another before-hook rewrites `body`.
 * Symbol.for keeps the key stable across duplicate module evaluations.
 */
const RECURBUY_FINALIZERS = Symbol.for('recurbuy.cartFinalizers');

/**
 * @typedef {Object} CartSelectionProvider
 * @property {(skus: string[]) => boolean} matches
 * @property {() => import('../contract.js').SubscriptionSelection} getSelection
 * @property {() => boolean} isSelectionValid
 * @property {() => CartProductData|null} getProductData
 */

/**
 * @typedef {{ sku?: string, externalId?: string, id?: string, name?: string }} CartProductData
 */

/**
 * @typedef {{
 *   finalize: (args?: Record<string, unknown>) => Promise<string|void>,
 *   planUnit: { value: number, currency?: string }|null,
 *   optionId: string|null,
 * }} SubscriptionAddFinalize
 */

/**
 * @param {RequestInit} requestInit
 * @returns {{ query: string, variables: Record<string, any> }|null}
 */
function readAddPayload(requestInit) {
  if (typeof requestInit?.body !== 'string') return null;
  if (!requestInit.body.includes(ADD_OPERATION)) return null;
  try {
    const payload = JSON.parse(requestInit.body);
    return typeof payload?.query === 'string' && payload.query.includes(ADD_OPERATION)
      ? payload
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any>} item GraphQL CartItemInput
 * @returns {string[]}
 */
function itemSkus(item) {
  return [item?.sku, item?.parent_sku]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim().toLowerCase());
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function sameSku(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * GraphQL CartItemInput → drop-in values shape used by prepare.
 * @param {Record<string, any>} item
 */
function toDropinValues(item) {
  return {
    sku: item.sku,
    quantity: item.quantity,
    ...(item.parent_sku ? { parentSku: item.parent_sku } : {}),
    ...(item.selected_options ? { optionsUIDs: item.selected_options } : {}),
    ...(item.entered_options ? { enteredOptions: item.entered_options } : {}),
  };
}

/**
 * @param {Record<string, any>} item
 * @param {Record<string, unknown>} extras prepare().adobeExtras
 */
function withExtras(item, extras) {
  const next = { ...item };
  // Configurable ATC often sends parent as `sku` + selected_options (no parent_sku).
  // PDP product.sku may only differ by case ("Configurable-1" vs "configurable-1");
  // injecting parent_sku for that makes AccS return Internal server error.
  if (
    typeof extras.parentSku === 'string'
    && extras.parentSku.trim() !== ''
    && !sameSku(extras.parentSku, item.sku)
  ) {
    next.parent_sku = extras.parentSku;
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'enteredOptions')) {
    next.entered_options = extras.enteredOptions;
  }
  return next;
}

/**
 * @param {{
 *   client: { addBeforeHook: Function, addAfterHook: Function },
 *   refreshCart: () => Promise<unknown>,
 *   events: { on: (name: string, cb: Function, opts?: object) => { off: () => void } },
 *   prepareCartItem: (args: object) => Promise<{
 *     adobeExtras: Record<string, unknown>,
 *     finalize: SubscriptionAddFinalize['finalize'],
 *     planUnit?: SubscriptionAddFinalize['planUnit'],
 *   }>,
 * }} deps
 *   `client` is the FetchGraphQL instance cart uses (`CORE_FETCH_GRAPHQL`).
 */
export function createCartMutationHooks({
  client, refreshCart, events, prepareCartItem,
}) {
  /** @type {Set<CartSelectionProvider>} */
  const providers = new Set();
  /**
   * FIFO fallback when a later before-hook replaces requestInit without
   * spreading the Symbol-tagged object (body-string Map keys were brittle).
   * @type {SubscriptionAddFinalize[][]}
   */
  const pendingFinalizerQueue = [];
  /** @type {{ off: () => void }|null} */
  let pendingRefresh = null;
  let enabled = true;
  let installed = false;

  /**
   * @param {RequestInit|null|undefined} requestInit
   * @returns {SubscriptionAddFinalize[]|null}
   */
  const takeFinalizers = (requestInit) => {
    const tagged = requestInit != null && typeof requestInit === 'object'
      ? /** @type {Record<PropertyKey, unknown>} */ (requestInit)[RECURBUY_FINALIZERS]
      : null;
    if (Array.isArray(tagged) && tagged.length) {
      const idx = pendingFinalizerQueue.indexOf(
        /** @type {SubscriptionAddFinalize[]} */ (tagged),
      );
      // Only this instance's queue may claim the tag (isolation across carts).
      if (idx < 0) return null;
      pendingFinalizerQueue.splice(idx, 1);
      delete /** @type {Record<PropertyKey, unknown>} */ (requestInit)[RECURBUY_FINALIZERS];
      return /** @type {SubscriptionAddFinalize[]} */ (tagged);
    }
    if (!readAddPayload(requestInit) || pendingFinalizerQueue.length === 0) {
      return null;
    }
    return pendingFinalizerQueue.shift() || null;
  };

  /**
   * @param {Record<string, any>} item
   * @returns {CartSelectionProvider|null}
   */
  const findProvider = (item) => {
    const skus = itemSkus(item);
    if (!skus.length) return null;
    return [...providers].find((provider) => provider.matches(skus)) || null;
  };

  const clearPendingRefresh = () => {
    const pending = pendingRefresh;
    pendingRefresh = null;
    pending?.off();
  };

  /**
   * The refresh must not overlap the drop-in consuming the add response: it
   * publishes `cart/data` right after it mapped that response, so a one-shot
   * non-eager listener (eager would replay a stale payload at once) fires
   * exactly when it is safe to refresh. One pending listener per instance.
   */
  const refreshAfterNextCartData = () => {
    if (!enabled || pendingRefresh || typeof refreshCart !== 'function') return;

    let fired = false;
    const subscription = events.on('cart/data', () => {
      fired = true;
      clearPendingRefresh();
      if (!enabled) return;
      Promise.resolve(refreshCart()).catch((error) => {
        console.warn('RecurBuy cart refresh failed:', error);
      });
    });
    if (fired) {
      subscription.off();
    } else {
      pendingRefresh = subscription;
    }
  };

  /**
   * @param {RequestInit} requestInit
   * @returns {Promise<RequestInit>}
   */
  const beforeAddToCart = async (requestInit) => {
    if (!enabled || !providers.size) return requestInit;
    const payload = readAddPayload(requestInit);
    const items = payload?.variables?.cartItems;
    if (!Array.isArray(items)) return requestInit;

    /** @type {SubscriptionAddFinalize[]} */
    const finalizers = [];
    const nextItems = await items.reduce(async (accPromise, item) => {
      const acc = await accPromise;
      const provider = findProvider(item);
      const selection = provider?.getSelection();
      if (!provider || selection?.purchaseType !== 'subscription') {
        return [...acc, item];
      }
      if (!provider.isSelectionValid()) {
        throw new Error('Please choose a subscription option.');
      }
      const prepared = await prepareCartItem({
        values: toDropinValues(item),
        selection,
        productData: provider.getProductData(),
        mode: 'add',
      });
      const optionId = selection?.subscriptionOptionId || selection?.planId || null;
      finalizers.push({
        finalize: prepared.finalize,
        planUnit: prepared.planUnit || null,
        optionId: optionId != null ? String(optionId) : null,
      });
      return [...acc, withExtras(item, prepared.adobeExtras)];
    }, Promise.resolve([]));

    if (!finalizers.length) return requestInit;

    const body = JSON.stringify({
      ...payload,
      variables: { ...payload.variables, cartItems: nextItems },
    });
    /** @type {RequestInit & Record<PropertyKey, unknown>} */
    const next = { ...requestInit, body };
    next[RECURBUY_FINALIZERS] = finalizers;
    pendingFinalizerQueue.push(finalizers);
    return next;
  };

  /**
   * Runs before the cart drop-in consumes the response, so stock blocks that
   * redirect right after `await addProductsToCart` still get a finalized line.
   *
   * @param {RequestInit} requestInit
   * @param {{ data?: any, errors?: unknown[] }} response
   */
  const afterAddToCart = async (requestInit, response) => {
    const finalizers = takeFinalizers(requestInit);
    if (!finalizers) return response;

    const result = response?.data?.addProductsToCart;
    const failed = (response?.errors?.length ?? 0) > 0
      || (result?.user_errors?.length ?? 0) > 0
      || !result?.cart;
    if (failed) return response;

    // AccS addProductsToCart still returns catalog units in the same mutation
    // response. Stamp attrs, paint PDP plan unit onto GraphQL prices for first
    // MiniCart frame (still GraphQL itemsV2 shape), then refresh for Magento SoR.
    // Finalize errors must not reject the host add — Magento already committed
    // the line; throwing here used to skip setCustomAttributesOnCartItem entirely.
    /** @type {Array<{
     *   uid?: string|null,
     *   planUnit?: { value: number, currency?: string }|null,
     *   optionId?: string|null,
     * }>} */
    const painted = [];
    await finalizers.reduce(
      (previous, entry) => previous.then(async () => {
        try {
          const uid = await entry.finalize({
            refresh: false,
            cartResult: result.cart,
          });
          painted.push({
            uid: typeof uid === 'string' ? uid : null,
            planUnit: entry.planUnit,
            optionId: entry.optionId,
          });
        } catch (error) {
          console.warn('RecurBuy cart finalize failed:', error);
        }
      }),
      Promise.resolve(),
    );

    normalizeGraphqlCartData(response?.data, { optimisticLines: painted });
    refreshAfterNextCartData();

    return response;
  };

  /**
   * Every cart response: normalise raw GraphQL cart, then finalize subscription lines.
   *
   * @param {RequestInit} requestInit
   * @param {{ data?: any, errors?: unknown[] }} response
   */
  const afterCartResponse = async (requestInit, response) => {
    if (!enabled) return response;
    normalizeGraphqlCartData(response?.data);
    return afterAddToCart(requestInit, response);
  };

  return {
    /**
     * @param {CartSelectionProvider} provider
     * @returns {() => void} unregister
     */
    registerSelectionProvider(provider) {
      if (!enabled) return () => {};
      providers.add(provider);
      return () => providers.delete(provider);
    },

    /** Attach the hooks to the client. Idempotent. */
    install() {
      if (!client || installed || !enabled) return;
      installed = true;
      client.addBeforeHook(beforeAddToCart);
      client.addAfterHook(afterCartResponse);
    },

    /**
     * FetchGraphQL hooks cannot be removed, so they stay attached and turn
     * into pass-throughs.
     */
    dispose() {
      enabled = false;
      providers.clear();
      pendingFinalizerQueue.length = 0;
      clearPendingRefresh();
    },
  };
}
