/**
 * Subscription add-to-cart through Adobe FetchGraphQL hooks.
 * Stock blocks keep calling `addProductsToCart`; the hook enriches the
 * mutation (pending-add + merge option) and finalizes the line afterwards.
 */

import { refreshCart } from '@dropins/storefront-cart/api.js';
import { captureCartLineAttributes } from '../cart-line-custom-attributes.js';
import { prepareSubscriptionCartItem } from '../subscription-add-to-cart.js';

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

/** @type {Set<CartSelectionProvider>} */
const providers = new Set();

/** @type {Map<string, Array<(args?: Record<string, unknown>) => Promise<void>>>} */
const pendingFinalizers = new Map();

/** @type {WeakSet<object>} */
const hookedClients = new WeakSet();

/**
 * @param {CartSelectionProvider} provider
 * @returns {() => void} unregister
 */
export function registerCartSelectionProvider(provider) {
  providers.add(provider);
  return () => providers.delete(provider);
}

/**
 * @param {{ addBeforeHook: Function, addAfterHook: Function }} client
 *   The FetchGraphQL instance cart uses (`CORE_FETCH_GRAPHQL`).
 */
export function installCartMutationHooks(client) {
  if (!client || hookedClients.has(client)) return;
  hookedClients.add(client);
  client.addBeforeHook(beforeAddToCart);
  client.addAfterHook(afterCartResponse);
}

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
 * @param {Record<string, any>} item
 * @returns {CartSelectionProvider|null}
 */
function findProvider(item) {
  const skus = itemSkus(item);
  if (!skus.length) return null;
  return [...providers].find((provider) => provider.matches(skus)) || null;
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
 * @param {RequestInit} requestInit
 * @returns {Promise<RequestInit>}
 */
async function beforeAddToCart(requestInit) {
  const payload = readAddPayload(requestInit);
  const items = payload?.variables?.cartItems;
  if (!Array.isArray(items) || !providers.size) return requestInit;

  const finalizers = [];
  // Sequential: pending-add rows must register per line before the mutation.
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
    const prepared = await prepareSubscriptionCartItem({
      values: toDropinValues(item),
      selection,
      productData: provider.getProductData(),
      mode: 'add',
    });
    finalizers.push(prepared.finalize);
    return [...acc, withExtras(item, prepared.adobeExtras)];
  }, Promise.resolve([]));

  if (!finalizers.length) return requestInit;

  const body = JSON.stringify({
    ...payload,
    variables: { ...payload.variables, cartItems: nextItems },
  });
  pendingFinalizers.set(body, finalizers);
  return { ...requestInit, body };
}

/**
 * Every cart response: remember the line markers, then finalize pending adds.
 *
 * @param {RequestInit} requestInit
 * @param {{ data?: any, errors?: unknown[] }} response
 */
async function afterCartResponse(requestInit, response) {
  captureCartLineAttributes(response?.data);
  return afterAddToCart(requestInit, response);
}

/**
 * Runs before the cart drop-in consumes the response, so stock blocks that
 * redirect right after `await addProductsToCart` still get a finalized line.
 *
 * @param {RequestInit} requestInit
 * @param {{ data?: any, errors?: unknown[] }} response
 */
async function afterAddToCart(requestInit, response) {
  const finalizers = typeof requestInit?.body === 'string'
    ? pendingFinalizers.get(requestInit.body)
    : null;
  if (!finalizers) return response;
  pendingFinalizers.delete(requestInit.body);

  const result = response?.data?.addProductsToCart;
  const failed = (response?.errors?.length ?? 0) > 0
    || (result?.user_errors?.length ?? 0) > 0
    || !result?.cart;
  if (failed) return response;

  await finalizers.reduce(
    (previous, finalize) => previous.then(() => finalize({ refresh: false })),
    Promise.resolve(),
  );

  // The drop-in emits cart/data from this (pre-attributes) response; repaint after it.
  setTimeout(() => {
    refreshCart?.();
  }, 0);

  return response;
}
