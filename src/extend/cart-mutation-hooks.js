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
  if (typeof extras.parentSku === 'string' && extras.parentSku !== item.sku) {
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
  /** @type {Map<string, SubscriptionAddFinalize[]>} keyed by rewritten request body */
  const subscriptionFinalizers = new Map();
  /** @type {{ off: () => void }|null} */
  let pendingRefresh = null;
  let enabled = true;
  let installed = false;

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
    subscriptionFinalizers.set(body, finalizers);
    return { ...requestInit, body };
  };

  /**
   * Runs before the cart drop-in consumes the response, so stock blocks that
   * redirect right after `await addProductsToCart` still get a finalized line.
   *
   * @param {RequestInit} requestInit
   * @param {{ data?: any, errors?: unknown[] }} response
   */
  const afterAddToCart = async (requestInit, response) => {
    const finalizers = typeof requestInit?.body === 'string'
      ? subscriptionFinalizers.get(requestInit.body)
      : null;
    if (!finalizers) return response;
    subscriptionFinalizers.delete(requestInit.body);

    const result = response?.data?.addProductsToCart;
    const failed = (response?.errors?.length ?? 0) > 0
      || (result?.user_errors?.length ?? 0) > 0
      || !result?.cart;
    if (failed) return response;

    // AccS addProductsToCart still returns catalog units in the same mutation
    // response. Stamp attrs, paint PDP plan unit onto GraphQL prices for first
    // MiniCart frame (still GraphQL itemsV2 shape), then refresh for Magento SoR.
    /** @type {Array<{
     *   uid?: string|null,
     *   planUnit?: { value: number, currency?: string }|null,
     *   optionId?: string|null,
     * }>} */
    const painted = [];
    await finalizers.reduce(
      (previous, entry) => previous.then(async () => {
        const uid = await entry.finalize({
          refresh: false,
          cartResult: result.cart,
        });
        painted.push({
          uid: typeof uid === 'string' ? uid : null,
          planUnit: entry.planUnit,
          optionId: entry.optionId,
        });
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
      subscriptionFinalizers.clear();
      clearPendingRefresh();
    },
  };
}
