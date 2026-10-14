import {
  getCartData,
  createGuestCart,
  refreshCart,
} from '@dropins/storefront-cart/api.js';
import { postPendingSubscriptionAdd } from './adapters/storefront-pending-add-adapter.js';
import {
  loadCachedSubscriptionConfigSoft,
  peekCachedSubscriptionConfig,
} from './adapters/subscription-config-cache.js';
import { selectionSkusFromAccsValues } from './bundle-price.js';
import { CartPayloadAdapter } from './cart-payload-adapter.js';
import {
  findItemUid,
  setSubscriptionAttributes,
  nudgeQuantity,
} from './cart-item-attributes.js';
import { saveSelectionForSku, saveSelectionForUid } from './selection-store.js';

/**
 * @param {string} cartId
 * @param {string} itemUid
 * @param {number} quantity
 * @param {number} planUnitValue
 */
async function repriceBundleIfStillCatalog(cartId, itemUid, quantity, planUnitValue) {
  try {
    const cart = await getCartData();
    const line = (cart?.items || []).find((entry) => entry?.uid === itemUid);
    if (!line || line.itemType !== 'BundleCartItem') return;
    const magento = typeof line.price?.value === 'number' ? line.price.value : null;
    if (magento == null || !(magento > planUnitValue * 1.15)) return;

    await nudgeQuantity(cartId, itemUid, quantity + 1);
    await nudgeQuantity(cartId, itemUid, quantity);
  } catch {
    // Best-effort: stamped plan unit still paints the mini-cart after navigation.
  }
}

/**
 * AccS GraphQL: sales_quote_item_save_before runs on addProductsToCart
 * *before* setCustomAttributesOnCartItem. Pending-add is required so the
 * price webhook knows the option on first save. Attrs+nudge remain as backup.
 *
 * Mixed one-time + subscription of the same variant: Magento SARP uses
 * addCustomOption('aw_sarp2_subscription_type'). AccS equivalent is a real
 * catalog field option passed as entered_options (see CartPayloadAdapter +
 * subscription-config accsCartMergeOption).
 *
 * Canonical merchant path: prepareSubscriptionCartItem → Adobe add/update →
 * prepared.finalize. Convenience wrappers only delegate to that sequence.
 */
const USE_PENDING_SUBSCRIPTION_ADD = true;

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
 * @param {{ externalId?: string, id?: string }|null|undefined} productData
 * @returns {string|null}
 */
function peekAccsCartMergeOptionUid(productData) {
  const productId = productData?.externalId || productData?.id;
  const config = peekCachedSubscriptionConfig(productId);
  const merge = config?.accsCartMergeOption;
  if (!merge || typeof merge !== 'object') return null;
  const { uid } = /** @type {{ uid?: unknown }} */ (merge);
  return typeof uid === 'string' && uid.trim() !== '' ? uid.trim() : null;
}

/**
 * Resolve AccS merge-key option uid from subscription-config when callers omit it.
 *
 * @param {{ externalId?: string, id?: string }|null|undefined} productData
 * @param {string|null|undefined} explicitUid
 * @returns {Promise<string|null>}
 */
async function resolveAccsCartMergeOptionUid(productData, explicitUid = null) {
  if (typeof explicitUid === 'string' && explicitUid.trim() !== '') {
    return explicitUid.trim();
  }
  const cached = peekAccsCartMergeOptionUid(productData);
  if (cached) return cached;
  const productId = productData?.externalId || productData?.id;
  await loadCachedSubscriptionConfigSoft(productId);
  return peekAccsCartMergeOptionUid(productData);
}

/**
 * Masked cart id for pending-add. Guest carts are not created until the first add,
 * and `createGuestCart` returns the id string, not a cart object.
 *
 * @returns {Promise<string>}
 */
async function resolveCartId() {
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
 * @param {string} sku
 * @param {Object} selection
 * @param {number|string} catalogProductId
 * @param {string[]} [selectionSkus]
 * @returns {Promise<string|number>}
 */
async function registerPendingSubscription(
  cartId,
  sku,
  selection,
  catalogProductId,
  selectionSkus = null,
) {
  const subscriptionOptionId = resolveSubscriptionOptionId(selection);

  if (!USE_PENDING_SUBSCRIPTION_ADD) {
    return subscriptionOptionId;
  }

  if (!catalogProductId) {
    throw new Error('[RecurBuy] Missing catalogProductId required for pending subscription add.');
  }

  // One pending row (sku + catalog_product_id index). AccS child SKU saves match via
  // product id; do not also register parent SKU — a leftover sibling pending would
  // price a later one-time add as a plan (no pending ⇒ one-time).
  await postPendingSubscriptionAdd({
    cartId,
    sku,
    subscriptionOptionId,
    catalogProductId,
    selectionSkus,
  });

  return subscriptionOptionId;
}

/**
 * @param {string} cartId
 * @param {string} itemUid
 * @param {string|number} subscriptionOptionId
 * @param {Object} selection
 * @param {number} quantity
 */
async function persistSubscriptionLine(cartId, itemUid, subscriptionOptionId, selection, quantity) {
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
  const qty = quantity || 1;
  await nudgeQuantity(cartId, itemUid, qty);

  // AccS dynamic bundles often skip selection save_before when the same picks are
  // already in the quote. GraphQL then keeps the catalog/sale child sum. A qty
  // bump forces Magento to re-save children so the price webhook can plan-price them.
  if (planUnit && typeof planUnit.value === 'number' && planUnit.value > 0) {
    await repriceBundleIfStillCatalog(cartId, itemUid, qty, planUnit.value);
  }
}

/**
 * Additive AccS hook for merchant blocks: prepare → keep Adobe add/update → finalize.
 *
 * One-time selection: pending is skipped; finalize is a no-op.
 *
 * @param {{
 *   values: Record<string, unknown>|null|undefined,
 *   selection?: import('./contract.js').SubscriptionSelection|null,
 *   productData?: { sku?: string, externalId?: string, id?: string, name?: string }|null,
 *   mode?: 'add'|'update',
 *   itemUid?: string|null,
 *   accsCartMergeOptionUid?: string|null,
 * }} input
 * @returns {Promise<{
 *   cartItem: Record<string, unknown>,
 *   adobeExtras: Record<string, unknown>,
 *   finalize: (args?: {
 *     cartResult?: unknown,
 *     itemUid?: string|null,
 *     refresh?: boolean,
 *   }) => Promise<void>,
 * }>}
 */
export async function prepareSubscriptionCartItem(input) {
  const {
    values,
    selection = { purchaseType: 'one_time' },
    productData = null,
    mode = 'add',
    itemUid = null,
    accsCartMergeOptionUid = null,
  } = input;

  const catalogProductId = productData?.externalId || productData?.id;
  const resolvedMergeUid = isSubscriptionSelection(selection)
    ? await resolveAccsCartMergeOptionUid(productData, accsCartMergeOptionUid)
    : null;
  const lineValues = values || { sku: productData?.sku, quantity: 1 };
  const selectionSkus = isSubscriptionSelection(selection)
    ? selectionSkusFromAccsValues(lineValues, productData, selection)
    : [];

  let cartItem = CartPayloadAdapter.enrich(
    lineValues,
    selection,
    {
      parentSku: productData?.sku,
      selectedPlan: selection?.selectedPlan,
      accsCartMergeOptionUid: resolvedMergeUid,
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

  const cartId = await resolveCartId();
  const cartBefore = await readCartQuietly();
  const subscriptionOptionId = await registerPendingSubscription(
    cartId,
    cartItem.sku,
    selection,
    catalogProductId,
    selectionSkus,
  );

  return {
    cartItem,
    adobeExtras,
    finalize: async (args = {}) => {
      const finalizeUid = args.itemUid || itemUid;
      let currentCart = args.cartResult || (await getCartData());
      let targetUid = mode === 'update'
        ? (finalizeUid || findItemUid(currentCart, cartItem.sku, cartItem.parentSku))
        : resolveAddedItemUid(cartBefore, currentCart, cartItem);

      if (!targetUid && typeof refreshCart === 'function') {
        currentCart = (await refreshCart()) || currentCart;
        targetUid = mode === 'update'
          ? (finalizeUid || findItemUid(currentCart, cartItem.sku, cartItem.parentSku))
          : resolveAddedItemUid(cartBefore, currentCart, cartItem);
      }

      if (!targetUid) {
        throw new Error(`[RecurBuy] Cart item UID not found for SKU: ${cartItem.sku}`);
      }

      rememberResolvedLineSelection(currentCart, targetUid, selection);
      await persistSubscriptionLine(
        cartId,
        targetUid,
        subscriptionOptionId,
        selection,
        mode === 'update'
          ? (cartItem.quantity || 1)
          : quantityOnLine(currentCart, targetUid, cartItem.quantity),
      );

      if (args.refresh !== false && typeof refreshCart === 'function') {
        await refreshCart();
      }
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
 * @param {Object|null|undefined} cart
 * @returns {Array<{ uid?: string, quantity?: number }>}
 */
function cartLines(cart) {
  const items = cart?.items || cart?.itemsV2?.items || [];
  return Array.isArray(items) ? items : [];
}

/**
 * Quote-item identity for this add.
 * A new variant is a new uid. The same variant is the line whose quantity grew.
 * Configurable children share the parent SKU, so the parent is not an identity.
 * Selected option UIDs are the variant key Magento stored on the line.
 *
 * @param {Object|null|undefined} beforeCart
 * @param {Object|null|undefined} afterCart
 * @param {{ sku?: string, optionsUIDs?: string[] }} [cartItem]
 * @returns {string|null}
 */
function resolveAddedItemUid(beforeCart, afterCart, cartItem) {
  const after = cartLines(afterCart).filter((item) => item?.uid);
  if (after.length === 0) return null;

  const beforeQty = new Map(
    cartLines(beforeCart)
      .filter((item) => item?.uid)
      .map((item) => [item.uid, Number(item.quantity) || 0]),
  );

  const delta = beforeQty.size === 0
    ? after
    : after.filter((item) => {
      if (!beforeQty.has(item.uid)) return true;
      return (Number(item.quantity) || 0) > beforeQty.get(item.uid);
    });

  if (delta.length === 0) return null;

  const requestedOptions = optionUidSet(cartItem?.optionsUIDs);
  if (requestedOptions.length > 0) {
    const byOptions = delta.filter((item) => sameOptionSet(
      optionUidSet(item.selectedOptionsUIDs),
      requestedOptions,
    ));
    if (byOptions.length === 1) return byOptions[0].uid;
    if (byOptions.length > 1) return null;
  }

  const requestedSku = typeof cartItem?.sku === 'string' ? cartItem.sku.trim().toLowerCase() : '';
  if (requestedSku) {
    const bySku = delta.filter((item) => {
      const own = typeof item.sku === 'string' ? item.sku.trim().toLowerCase() : '';
      return own !== '' && own === requestedSku;
    });
    if (bySku.length === 1) return bySku[0].uid;
  }

  return delta.length === 1 ? delta[0].uid : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function optionUidSet(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === 'object') {
    list = Object.values(value);
  }

  return list
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry !== '')
    .sort();
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function sameOptionSet(left, right) {
  return left.length > 0
    && left.length === right.length
    && left.every((uid, index) => uid === right[index]);
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

  const items = cart?.items || cart?.itemsV2?.items || [];
  const line = Array.isArray(items)
    ? items.find((item) => item?.uid === itemUid)
    : null;
  const lineSku = typeof line?.sku === 'string' ? line.sku.trim() : '';
  if (lineSku) {
    saveSelectionForSku(lineSku, selection);
  }
  saveSelectionForUid(itemUid, selection);
}

function quantityOnLine(cart, itemUid, fallback) {
  const items = cart?.items || cart?.itemsV2?.items || [];
  const line = Array.isArray(items)
    ? items.find((item) => item?.uid === itemUid)
    : null;
  const current = Number(line?.quantity);
  if (Number.isFinite(current) && current > 0) return current;

  const requested = Number(fallback);
  return Number.isFinite(requested) && requested > 0 ? requested : 1;
}
