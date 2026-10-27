/**
 * Mount the subscription selector into the stock Product Details block
 * without editing its decorate(): waits for the block's price slot, inserts
 * RecurBuy roots next to it, and feeds the selection to the cart hooks.
 */

import { events } from '@dropins/tools/event-bus.js';
import { createDeferredRoots } from './deferred-roots.js';
import {
  attachPdpSubscription,
} from './product-details.js';

const DEFAULTS = {
  blockSelector: '.product-details',
  priceSelector: '.product-details__price',
  detailsAfterSelector: '.product-details__add-to-cart-status',
  atcSelector: '.product-details__buttons button, .product-details [class*="add-to-cart"] button',
};

/**
 * @param {string} className
 */
function createRoot(className) {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

/**
 * @param {unknown} value
 */
function normalizeSku(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Prefer configurable parent id for subscription-config / eligibility.
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
 * @param {HTMLElement} block
 * @param {ReturnType<typeof attachPdpSubscription>} controller
 * @param {string} atcSelector
 * @returns {() => void} stop waiting for the native button
 */
function bindAtcButton(block, controller, atcSelector) {
  const bind = () => {
    const native = block.querySelector(atcSelector);
    if (!(native instanceof HTMLButtonElement)) return false;
    controller.bindCartButton(wrapNativeButton(native));
    return true;
  };
  if (bind()) return () => {};
  const observer = new MutationObserver(() => {
    if (bind()) observer.disconnect();
  });
  observer.observe(block, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * @param {HTMLElement} block
 * @param {typeof DEFAULTS} selectors
 * @param {(provider: import('./cart-mutation-hooks.js').CartSelectionProvider) => () => void
 * } registerSelectionProvider
 * @returns {(() => void)|null} unmount, or null when the block is not ready yet
 */
function mountInBlock(block, selectors, registerSelectionProvider) {
  const price = block.querySelector(selectors.priceSelector);
  if (!(price instanceof HTMLElement)) return null;

  // Roots enter the document only while RecurBuy has something to show.
  const priceRoot = createRoot('product-details__subscription-price');
  const selectorRoot = createRoot('product-details__subscription');
  const detailsRoot = createRoot('product-details__subscription-details');
  const roots = createDeferredRoots({
    roots: [priceRoot, selectorRoot, detailsRoot],
    attach: () => {
      price.after(priceRoot, selectorRoot);
      const detailsAnchor = block.querySelector(selectors.detailsAfterSelector);
      if (detailsAnchor) {
        detailsAnchor.after(detailsRoot);
      } else {
        selectorRoot.after(detailsRoot);
      }
    },
  });

  const controller = attachPdpSubscription({
    selectorRoot,
    priceRoot,
    productPriceRoot: price,
    detailsRoot,
    onChange: (_selection, meta) => roots.setVisible(meta.visible),
  });

  const validListener = events.on('pdp/valid', controller.onProductValid, { eager: true });
  const stopBinding = bindAtcButton(block, controller, selectors.atcSelector);

  const unregister = registerSelectionProvider({
    matches(skus) {
      const product = events.lastPayload('pdp/data');
      const own = normalizeSku(product?.sku);
      return own !== '' && skus.includes(own);
    },
    getSelection: () => controller.getSelection(),
    isSelectionValid: () => controller.isSelectionValid(),
    getProductData: () => catalogProductData(events.lastPayload('pdp/data')),
  });

  return () => {
    unregister();
    stopBinding();
    validListener.off();
    controller.destroy?.();
    roots.dispose();
  };
}

/**
 * No-op on pages without a Product Details block.
 *
 * @param {Partial<typeof DEFAULTS> & {
 *   registerSelectionProvider: (
 *     provider: import('./cart-mutation-hooks.js').CartSelectionProvider,
 *   ) => () => void,
 * }} options
 * @returns {() => void} unmount
 */
export function autoMountProductDetails({ registerSelectionProvider, ...overrides }) {
  if (typeof registerSelectionProvider !== 'function') {
    throw new Error('autoMountProductDetails requires registerSelectionProvider');
  }
  if (typeof document === 'undefined') return () => {};
  const selectors = { ...DEFAULTS, ...overrides };
  const block = document.querySelector(selectors.blockSelector);
  if (!(block instanceof HTMLElement)) return () => {};

  let unmount = mountInBlock(block, selectors, registerSelectionProvider);
  if (unmount) return () => unmount();

  const observer = new MutationObserver(() => {
    const mounted = mountInBlock(block, selectors, registerSelectionProvider);
    if (!mounted) return;
    unmount = mounted;
    observer.disconnect();
  });
  observer.observe(block, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    unmount?.();
  };
}
