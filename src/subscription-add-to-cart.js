import {
  getCartData,
  getCartDataFromCache,
  createGuestCart,
  refreshCart,
} from '@dropins/storefront-cart/api.js';
import {
  loadCachedSubscriptionConfigSoft,
  peekCachedSubscriptionConfig,
} from './adapters/subscription-config-cache.js';
import { CartPayloadAdapter } from './cart-payload-adapter.js';
import { setSubscriptionAttributes } from './cart-item-attributes.js';
import { findLineByUid, findLineUidBySku, resolveAddedLineUid } from './cart-lines.js';
import { isSafeSubscriptionStampTarget } from './recurbuy-line.js';
import {
  readCartLineOption,
  rememberCartLineOptionFromConfig,
  resolveCartLineEnteredOption,
} from './helpers/cart-line-option.js';
import { saveSelectionForSku, saveSelectionForUid } from './selection-store.js';

/**
 * AccS GraphQL: first add sends catalog field entered_options (Label [#id]) when
 * subscription-config exposes cartLineOption + planOptions[].cartLineValue.
 * Presentation attrs remain stamped after add via finalize.
 *
 * Canonical path: prepareSubscriptionCartItem → Adobe add/update → finalize.
 */

/**
 * PDP selection stores the RecurBuy option on `planId`.
 * Update flows also pass `subscriptionOptionId`.
 *
 * @param {Object|null|undefined} selection
 * @returns {string|number|undefined}
 */
function resolveSubscriptionOptionId(selection) {
  return selection?.subscriptionOptionId || selection?.optionId || selection?.planId;
}

/**
 * @param {Object|null|undefined} selection
 * @returns {boolean}
 */
function isSubscriptionSelection(selection) {
  const subscriptionOptionId = resolveSubscriptionOptionId(selection);
  return Boolean(subscriptionOptionId && Number(subscriptionOptionId) >= 1);
}

/**
 * @returns {Object|null}
 */
function readCachedCart() {
  try {
    return getCartDataFromCache?.() || null;
  } catch {
    return null;
  }
}

async function resolveCartId() {
  const cachedId = readCachedCart()?.id;
  if (cachedId) return String(cachedId);

  try {
    const cartData = await getCartData();
    if (cartData?.id) {
      return String(cartData.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no cart id/i.test(message)) {
      throw error;
    }
  }

  const created = await createGuestCart();
  const cartId = typeof created === 'string' ? created : created?.id;
  if (!cartId) {
    throw new Error('[RecurBuy] Failed to obtain or create a valid cart ID.');
  }
  return String(cartId);
}

/**
 * @param {string} cartId
 * @param {string} itemUid
 * @param {string|number} subscriptionOptionId
 * @param {Object} selection
 */
async function persistSubscriptionLine(
  cartId,
  itemUid,
  subscriptionOptionId,
  selection,
) {
  const snapshot = selection?.planSnapshot || {};
  const startDate = selection?.startDate
    || selection?.subscriptionStartDate
    || snapshot.startDate;

  const planUnit = snapshot.price && typeof snapshot.price.value === 'number'
    ? snapshot.price
    : null;

  await setSubscriptionAttributes(cartId, itemUid, subscriptionOptionId, {
    startDate,
    planLabel: snapshot.planLabel,
    period: snapshot.period,
    endsLabel: snapshot.endsLabel,
    planUnit,
  });
}

/**
 * @param {{ externalId?: string, id?: string }|null|undefined} productData
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function resolveSubscriptionConfig(productData) {
  const productId = productData?.externalId || productData?.id;
  const cached = peekCachedSubscriptionConfig(productId);
  if (cached) {
    rememberCartLineOptionFromConfig(cached);
    return cached;
  }
  const loaded = await loadCachedSubscriptionConfigSoft(productId);
  if (loaded) {
    rememberCartLineOptionFromConfig(loaded);
  }
  return loaded;
}

/**
 * Additive AccS hook for merchant blocks: prepare → keep Adobe add/update → finalize.
 *
 * One-time selection: finalize is a no-op.
 *
 * @param {{
 *   values: Record<string, unknown>|null|undefined,
 *   selection?: import('./contract.js').SubscriptionSelection|null,
 *   productData?: { sku?: string, externalId?: string, id?: string, name?: string }|null,
 *   mode?: 'add'|'update',
 *   itemUid?: string|null,
 * }} input
 * @returns {Promise<{
 *   cartItem: Record<string, unknown>,
 *   adobeExtras: Record<string, unknown>,
 *   planUnit: { value: number, currency?: string }|null,
 *   finalize: (args?: {
 *     cartResult?: unknown,
 *     itemUid?: string|null,
 *     refresh?: boolean,
 *   }) => Promise<string|void>,
 * }>}
 */
export async function prepareSubscriptionCartItem(input) {
  const {
    values,
    selection = { purchaseType: 'one_time' },
    productData = null,
    mode = 'add',
    itemUid = null,
  } = input;

  const lineValues = values || { sku: productData?.sku, quantity: 1 };

  const cachedConfig = await resolveSubscriptionConfig(productData);
  const subscriptionOptionId = resolveSubscriptionOptionId(selection);
  const cartLineEnteredOption = isSubscriptionSelection(selection)
    ? resolveCartLineEnteredOption(cachedConfig, subscriptionOptionId)
    : null;
  const cartLineOptionUid = readCartLineOption(cachedConfig)?.uid || null;

  let cartItem = CartPayloadAdapter.enrich(
    lineValues,
    selection,
    {
      parentSku: productData?.sku,
      selectedPlan: selection?.selectedPlan,
      planOptions: cachedConfig?.planOptions && typeof cachedConfig.planOptions === 'object'
        ? /** @type {Record<string, unknown>} */ (cachedConfig.planOptions)
        : null,
      cartLineEnteredOption,
      cartLineOptionUid,
    },
  );

  /** @type {Record<string, unknown>} */
  const adobeExtras = {};
  if (cartItem.parentSku) {
    adobeExtras.parentSku = cartItem.parentSku;
  }
  if (Object.prototype.hasOwnProperty.call(cartItem, 'enteredOptions')) {
    adobeExtras.enteredOptions = cartItem.enteredOptions;
  }

  if (mode === 'update') {
    cartItem = {
      ...cartItem,
      ...(itemUid ? { uid: itemUid } : {}),
      // Empty customFields forces the drop-in to replace the line (not qty-only).
      customFields: {},
    };
    adobeExtras.customFields = {};
  }

  if (!isSubscriptionSelection(selection)) {
    return {
      cartItem,
      adobeExtras,
      finalize: async () => {},
    };
  }

  const cartBefore = readCachedCart() || await readCartQuietly();
  const cartId = cartBefore?.id
    ? String(cartBefore.id)
    : await resolveCartId();

  const planUnit = selection?.planSnapshot?.price
    && typeof selection.planSnapshot.price.value === 'number'
    ? selection.planSnapshot.price
    : null;

  return {
    cartItem,
    adobeExtras,
    /** Plan unit from PDP snapshot — AccS add response is still catalog. */
    planUnit,
    finalize: async (args = {}) => {
      const finalizeUid = args.itemUid || itemUid;
      let currentCart = args.cartResult || (await getCartData());
      let targetUid = mode === 'update'
        ? (finalizeUid || findLineUidBySku(currentCart, cartItem.sku, cartItem.parentSku))
        : resolveAddedLineUid(cartBefore, currentCart, cartItem);

      if (!targetUid && typeof refreshCart === 'function') {
        currentCart = (await refreshCart()) || currentCart;
        targetUid = mode === 'update'
          ? (finalizeUid || findLineUidBySku(currentCart, cartItem.sku, cartItem.parentSku))
          : resolveAddedLineUid(cartBefore, currentCart, cartItem);
      }

      if (!targetUid) {
        throw new Error(`[RecurBuy] Cart item UID not found for SKU: ${cartItem.sku}`);
      }

      if (mode === 'add' && !isSafeSubscriptionStampTarget(cartBefore, targetUid, currentCart)) {
        throw new Error(
          '[RecurBuy] Refusing to stamp subscription attributes on a host cart line.',
        );
      }

      rememberResolvedLineSelection(currentCart, targetUid, selection);
      await persistSubscriptionLine(
        cartId,
        targetUid,
        subscriptionOptionId,
        selection,
      );

      if (args.refresh !== false && typeof refreshCart === 'function') {
        await refreshCart();
      }

      return targetUid;
    },
  };
}

/**
 * @returns {Promise<Object|null>}
 */
async function readCartQuietly() {
  try {
    return await getCartData();
  } catch {
    return null;
  }
}

/**
 * Cart lines use the variant SKU. Persist the snapshot on that SKU and uid so a
 * later add of another child does not repaint this line with the new plan price.
 *
 * @param {Object|null|undefined} cart
 * @param {string} itemUid
 * @param {Object|null|undefined} selection
 */
function rememberResolvedLineSelection(cart, itemUid, selection) {
  if (!itemUid || !isSubscriptionSelection(selection)) return;

  const line = findLineByUid(cart, itemUid);
  const lineSku = typeof line?.sku === 'string' ? line.sku.trim() : '';
  if (lineSku) {
    saveSelectionForSku(lineSku, selection);
  }
  saveSelectionForUid(itemUid, selection);
}
