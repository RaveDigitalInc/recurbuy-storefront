/**
 * Thin Extend glue for the Product Details block.
 * Merchant keeps Adobe PDP containers and alerts; RecurBuy owns selector / price / AccS add.
 */

import { getSubscriptionOptionIdFromCartItem } from '../cart-line-custom-attributes.js';
import { ensureRecurBuyStyles } from '../helpers/ensure-styles.js';
import { mountSubscriptionOnPdp } from '../mount-pdp.js';
import { getSelectionForCartItem } from '../selection-store.js';
import { prepareSubscriptionCartItem } from '../subscription-add-to-cart.js';

/**
 * @typedef {Object} ProductDetailsSubscriptionRoots
 * @property {HTMLElement} selectorRoot
 * @property {HTMLElement} priceRoot
 * @property {HTMLElement} [productPriceRoot]
 * @property {HTMLElement} [detailsRoot]
 */

/**
 * Mount RecurBuy subscription UI into merchant-provided DOM roots.
 *
 * @param {ProductDetailsSubscriptionRoots & {
 *   scope?: string,
 *   initialSelection?: import('../contract.js').SubscriptionSelection,
 *   onChange?: (selection: unknown, meta: {
 *     productValid: boolean,
 *     selectionValid: boolean,
 *   }) => void,
 * }} options
 * @returns {ReturnType<typeof mountSubscriptionOnPdp>}
 */
function mountProductDetailsSubscription(options) {
  ensureRecurBuyStyles();
  return mountSubscriptionOnPdp(options);
}

/**
 * One call for merchant PDP / mini-PDP: mount UI + keep cart button validity in sync.
 *
 * @param {ProductDetailsSubscriptionRoots & {
 *   scope?: string,
 *   initialSelection?: import('../contract.js').SubscriptionSelection,
 *   getLoading?: () => boolean,
 * }} options
 */
export function attachPdpSubscription(options) {
  const { getLoading, ...mountOptions } = options;

  /** @type {{ setProps: Function }|null} */
  let buttonRef = null;
  /** @type {ReturnType<typeof mountSubscriptionOnPdp>|null} */
  let controller = null;

  const validity = createCartActionValidityBridge({
    getButton: () => buttonRef,
    getSubscriptionController: () => controller,
    getLoading: getLoading || (() => false),
  });

  controller = mountProductDetailsSubscription({
    ...mountOptions,
    onChange: validity.onSubscriptionChange,
  });

  return {
    getSelection: () => controller.getSelection(),
    isSelectionValid: () => controller.isSelectionValid(),
    isActive: () => controller.isActive(),
    destroy: () => controller.destroy(),
    onProductValid: validity.onProductValid,
    sync: validity.sync,
    /**
     * @param {{ setProps: Function }|null|undefined} button
     */
    bindCartButton(button) {
      buttonRef = button || null;
      validity.sync();
    },
    /**
     * Additive AccS hook: call before Adobe add/update, then `finalize` after.
     * Keeps merchant blocks on native `@dropins/storefront-cart` calls.
     *
     * @param {Record<string, unknown>|null|undefined} values
     * @param {{
     *   productData?: { sku?: string, externalId?: string, id?: string, name?: string }|null,
     *   mode?: 'add'|'update',
     *   itemUid?: string|null,
     * }} [options]
     */
    async prepareCartItem(values, prepareOptions = {}) {
      // prepareSubscriptionCartItem owns merge uid + pending selection_skus.
      return prepareSubscriptionCartItem({
        values,
        selection: controller.getSelection(),
        productData: prepareOptions.productData,
        mode: prepareOptions.mode || 'add',
        itemUid: prepareOptions.itemUid,
      });
    },
  };
}

/**
 * Disable Add/Update cart button when PDP config or subscription selection is invalid.
 *
 * @param {{ setProps: Function }|null|undefined} button
 * @param {{
 *   productValid?: boolean,
 *   subscriptionController?: { isSelectionValid: () => boolean }|null,
 *   loading?: boolean,
 * }} [state]
 */
function setCartActionDisabled(button, state = {}) {
  if (!button) return;
  const {
    productValid = true,
    subscriptionController = null,
    loading = false,
  } = state;
  const selectionValid = subscriptionController
    ? subscriptionController.isSelectionValid()
    : true;
  const disabled = loading || !productValid || !selectionValid;

  if (typeof button.setProps === 'function') {
    button.setProps((prev) => ({
      ...prev,
      disabled,
    }));
    return;
  }

  if (button instanceof HTMLButtonElement) {
    button.disabled = disabled;
  }
}

/**
 * Keeps Add/Update button disabled state in sync with PDP + subscription validity.
 *
 * @param {{
 *   getSubscriptionController: () => { isSelectionValid: () => boolean }|null|undefined,
 *   getButton: () => { setProps: Function }|null|undefined,
 *   getLoading?: () => boolean,
 * }} options
 */
function createCartActionValidityBridge(options) {
  const {
    getSubscriptionController,
    getButton,
    getLoading = () => false,
  } = options;

  let productValid = true;

  const sync = () => {
    setCartActionDisabled(getButton(), {
      productValid,
      subscriptionController: getSubscriptionController(),
      loading: getLoading(),
    });
  };

  return {
    getProductValid: () => productValid,
    sync,
    /** Pass to `mountProductDetailsSubscription({ onChange })`. */
    onSubscriptionChange: (_selection, meta) => {
      productValid = meta.productValid;
      sync();
    },
    /** Pass to `events.on('pdp/valid', …)`. */
    onProductValid: (valid) => {
      productValid = valid;
      sync();
    },
  };
}

/**
 * Initial PDP / mini-PDP selection from quote customFields (durable) or
 * same-document optimistic cache.
 *
 * @param {{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 *   customFields?: Record<string, unknown>,
 * }|null|undefined} cartItem
 * @returns {import('../contract.js').SubscriptionSelection}
 */
export function resolveCartItemInitialSelection(cartItem) {
  const optionIdFromQuote = getSubscriptionOptionIdFromCartItem(cartItem);
  if (optionIdFromQuote) {
    return {
      purchaseType: 'subscription',
      planId: optionIdFromQuote,
      subscriptionOptionId: optionIdFromQuote,
    };
  }

  return getSelectionForCartItem(cartItem) || { purchaseType: 'one_time' };
}
