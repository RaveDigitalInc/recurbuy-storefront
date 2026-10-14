/**
 * Mount the subscription selector into the stock Product Details block
 * without editing its decorate(): waits for the block's price slot, inserts
 * RecurBuy roots next to it, and feeds the selection to the cart hooks.
 */

import { events } from '@dropins/tools/event-bus.js';
import {
  attachPdpSubscription,
} from './product-details.js';
import { registerCartSelectionProvider } from './cart-mutation-hooks.js';

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
 * Prefer configurable parent id for AccS pending-add / eligibility.
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
 */
function bindAtcButton(block, controller, atcSelector) {
  const bind = () => {
    const native = block.querySelector(atcSelector);
    if (!(native instanceof HTMLButtonElement)) return false;
    controller.bindCartButton(wrapNativeButton(native));
    return true;
  };
  if (bind()) return;
  const observer = new MutationObserver(() => {
    if (bind()) observer.disconnect();
  });
  observer.observe(block, { childList: true, subtree: true });
}

/**
 * @param {HTMLElement} block
 * @param {typeof DEFAULTS} selectors
 * @returns {boolean} mounted
 */
function mountInBlock(block, selectors) {
  const price = block.querySelector(selectors.priceSelector);
  if (!(price instanceof HTMLElement)) return false;

  const priceRoot = createRoot('product-details__subscription-price');
  const selectorRoot = createRoot('product-details__subscription');
  price.after(priceRoot, selectorRoot);

  const detailsRoot = createRoot('product-details__subscription-details');
  const detailsAnchor = block.querySelector(selectors.detailsAfterSelector);
  if (detailsAnchor) {
    detailsAnchor.after(detailsRoot);
  } else {
    selectorRoot.after(detailsRoot);
  }

  const controller = attachPdpSubscription({
    selectorRoot,
    priceRoot,
    productPriceRoot: price,
    detailsRoot,
  });

  events.on('pdp/valid', controller.onProductValid, { eager: true });
  bindAtcButton(block, controller, selectors.atcSelector);

  registerCartSelectionProvider({
    matches(skus) {
      const product = events.lastPayload('pdp/data');
      const own = normalizeSku(product?.sku);
      return own !== '' && skus.includes(own);
    },
    getSelection: () => controller.getSelection(),
    isSelectionValid: () => controller.isSelectionValid(),
    getProductData: () => catalogProductData(events.lastPayload('pdp/data')),
  });

  return true;
}

/**
 * No-op on pages without a Product Details block.
 *
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function autoMountProductDetails(options = {}) {
  if (typeof document === 'undefined') return;
  const selectors = { ...DEFAULTS, ...options };
  const block = document.querySelector(selectors.blockSelector);
  if (!(block instanceof HTMLElement)) return;

  if (mountInBlock(block, selectors)) return;

  const observer = new MutationObserver(() => {
    if (mountInBlock(block, selectors)) observer.disconnect();
  });
  observer.observe(block, { childList: true, subtree: true });
}
