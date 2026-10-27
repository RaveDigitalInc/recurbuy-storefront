/**
 * Mount subscription UI into stock commerce-mini-pdp and enrich Update via
 * Cart.updateProductsFromCart — no decorate() patches.
 */

import { events } from '@dropins/tools/event-bus.js';
import {
  addProductsToCart,
  getCartDataFromCache,
  updateProductsFromCart,
} from '@dropins/storefront-cart/api.js';
import {
  getProductConfigurationValues,
  isProductConfigurationValid,
} from '@dropins/storefront-pdp/api.js';
import { showError } from '../helpers/user-prompt.js';
import { getSubscriptionOptionIdFromCartItem } from '../cart-line-custom-attributes.js';
import { createDeferredRoots } from './deferred-roots.js';
import {
  attachPdpSubscription,
  resolveCartItemInitialSelection,
} from './product-details.js';

const SCOPE = 'modal';

/**
 * @param {unknown} value
 */
function normalizeSku(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Prefer configurable parent id for AccS (same as mount-pdp eligibility).
 * @param {Record<string, any>|null|undefined} product
 */
function catalogProductData(product) {
  if (!product) return null;
  const parent = typeof product.externalParentId === 'string'
    ? product.externalParentId.trim()
    : '';
  const child = product.externalId || product.id;
  return {
    ...product,
    externalId: parent || child,
    id: parent || child,
  };
}

/**
 * @typedef {{
 *   pendingEditUid: string|null,
 * }} EditState
 */

/**
 * Remember which cart line the merchant opened for edit.
 *
 * @param {EditState} state
 * @returns {() => void} remove the listener
 */
function installEditUidCapture(state) {
  const onClick = (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button) return;
    const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`;
    if (!/edit/i.test(label)) return;
    const row = button.closest('.dropin-cart-item');
    const testId = row?.getAttribute('data-testid') || '';
    const [, uid] = /^cart-list-item-entry-(.+)$/.exec(testId) || [];
    if (uid) state.pendingEditUid = uid;
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

/**
 * @param {string|null|undefined} uid
 * @param {string} sku
 */
function resolveCartItem(uid, sku) {
  const items = getCartDataFromCache()?.items || [];
  if (uid) {
    const byUid = items.find((item) => item?.uid === uid);
    if (byUid) return byUid;
  }
  const needle = normalizeSku(sku);
  if (!needle) return null;
  return items.find((item) => (
    normalizeSku(item?.sku) === needle || normalizeSku(item?.topLevelSku) === needle
  )) || null;
}

/**
 * @param {HTMLButtonElement} native
 */
function wrapNativeButton(native) {
  return {
    setProps(updater) {
      const next = typeof updater === 'function'
        ? updater({ disabled: native.disabled })
        : updater;
      if (next && Object.prototype.hasOwnProperty.call(next, 'disabled')) {
        native.disabled = Boolean(next.disabled);
      }
    },
  };
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   registerSelectionProvider: Function,
 *   state: EditState,
 * }} context
 * @returns {(() => void)|null} unmount, or null when the mini-PDP is not ready
 */
function mountMiniPdp(root, { registerSelectionProvider, state }) {
  const price = root.querySelector('.mini-pdp__price');
  if (!(price instanceof HTMLElement)) return null;

  // Roots enter the document only while RecurBuy has something to show.
  const priceRoot = document.createElement('div');
  priceRoot.className = 'mini-pdp__subscription-price';
  const selectorRoot = document.createElement('div');
  selectorRoot.className = 'mini-pdp__subscription';
  const roots = createDeferredRoots({
    roots: [priceRoot, selectorRoot],
    attach: () => price.after(priceRoot, selectorRoot),
  });

  const product = events.lastPayload('pdp/data', { scope: SCOPE })
    || events.lastPayload('pdp/data');
  const cartItem = resolveCartItem(state.pendingEditUid, product?.sku || '');

  const controller = attachPdpSubscription({
    selectorRoot,
    priceRoot,
    productPriceRoot: price,
    scope: SCOPE,
    initialSelection: resolveCartItemInitialSelection(cartItem),
    onChange: (_selection, meta) => roots.setVisible(meta.visible),
  });

  const validListener = events.on(
    'pdp/valid',
    controller.onProductValid,
    { eager: true, scope: SCOPE },
  );

  const unregister = registerSelectionProvider({
    matches(skus) {
      const data = events.lastPayload('pdp/data', { scope: SCOPE })
        || events.lastPayload('pdp/data');
      const own = normalizeSku(data?.sku);
      return own !== '' && skus.includes(own);
    },
    getSelection: () => controller.getSelection(),
    isSelectionValid: () => controller.isSelectionValid(),
    getProductData: () => catalogProductData(
      events.lastPayload('pdp/data', { scope: SCOPE })
      || events.lastPayload('pdp/data'),
    ),
  });

  const updateHost = root.querySelector('.mini-pdp__update-button');
  const bindButton = () => {
    const native = updateHost?.querySelector('button');
    if (!(native instanceof HTMLButtonElement)) return false;
    controller.bindCartButton(wrapNativeButton(native));
    return true;
  };
  /** @type {MutationObserver|null} */
  let buttonObserver = null;
  if (!bindButton()) {
    buttonObserver = new MutationObserver(() => {
      if (bindButton()) buttonObserver.disconnect();
    });
    buttonObserver.observe(updateHost || root, { childList: true, subtree: true });
  }

  const onUpdateClick = async (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    if (!target.closest('.mini-pdp__update-button')) return;

    // A subscription line switched to one-time must be replaced too, otherwise
    // the stock update keeps the subscription attribute on the line.
    const editedItem = resolveCartItem(state.pendingEditUid || cartItem?.uid, '');
    const leavesSubscription = Boolean(getSubscriptionOptionIdFromCartItem(editedItem));
    const isSubscription = controller.getSelection().purchaseType === 'subscription';
    if (!isSubscription && !leavesSubscription) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      if (!controller.isSelectionValid()
        || !isProductConfigurationValid({ scope: SCOPE })) {
        throw new Error('Please select all required options');
      }

      const values = getProductConfigurationValues({ scope: SCOPE }) || {};
      const data = catalogProductData(
        events.lastPayload('pdp/data', { scope: SCOPE })
        || events.lastPayload('pdp/data'),
      );
      const item = resolveCartItem(state.pendingEditUid || cartItem?.uid, data?.sku || '');
      if (!item?.uid) throw new Error('Cart item not found');

      const quantity = values.quantity || item.quantity || 1;
      let updateResponse;
      if (isSubscription) {
        const prepared = await controller.prepareCartItem(values, {
          productData: data,
          mode: 'update',
          itemUid: item.uid,
        });
        updateResponse = await updateProductsFromCart([{
          uid: item.uid,
          quantity,
          ...(values.optionsUIDs?.length ? { optionsUIDs: values.optionsUIDs } : {}),
          ...prepared.adobeExtras,
        }]);
        await prepared.finalize({ cartResult: updateResponse, itemUid: item.uid });
      } else {
        // The plan price and attributes live on the line, so it is replaced.
        await updateProductsFromCart([{ uid: item.uid, quantity: 0 }]);
        updateResponse = await addProductsToCart([{ ...values, quantity }]);
      }
      events.emit('cart/updated', updateResponse);

      // The stock update handler (skipped here) would close the modal dialog.
      root.closest('dialog')?.close();
    } catch (error) {
      console.error('RecurBuy mini-PDP update failed:', error);
      showError(root, error?.message || 'Could not update cart item');
    }
  };
  root.addEventListener('click', onUpdateClick, true);

  let cleaned = false;
  let disconnectObserver = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    disconnectObserver?.disconnect();
    buttonObserver?.disconnect();
    root.removeEventListener('click', onUpdateClick, true);
    validListener.off();
    unregister();
    controller.destroy?.();
    roots.dispose();
  };
  disconnectObserver = new MutationObserver(() => {
    if (!document.body.contains(root)) cleanup();
  });
  disconnectObserver.observe(document.body, { childList: true, subtree: true });

  return cleanup;
}

/**
 * No-op until a mini-PDP appears in the DOM.
 *
 * @param {{
 *   registerSelectionProvider: (
 *     provider: import('./cart-mutation-hooks.js').CartSelectionProvider,
 *   ) => () => void,
 * }} options
 * @returns {() => void} unmount everything this call mounted
 */
export function autoMountMiniPdp({ registerSelectionProvider }) {
  if (typeof registerSelectionProvider !== 'function') {
    throw new Error('autoMountMiniPdp requires registerSelectionProvider');
  }
  if (typeof document === 'undefined') return () => {};

  /** @type {EditState} */
  const state = { pendingEditUid: null };
  const removeEditCapture = installEditUidCapture(state);
  /** @type {Map<Element, () => void>} */
  const mounted = new Map();

  const scan = () => {
    document.querySelectorAll('.commerce-mini-pdp').forEach((node) => {
      if (!(node instanceof HTMLElement) || mounted.has(node)) return;
      const unmount = mountMiniPdp(node, { registerSelectionProvider, state });
      if (!unmount) return;
      mounted.set(node, () => {
        mounted.delete(node);
        unmount();
      });
    });
  };

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    removeEditCapture();
    [...mounted.values()].forEach((unmount) => unmount());
  };
}
