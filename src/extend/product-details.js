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
 *     active: boolean,
 *     visible: boolean,
 *     productValid: boolean,
 *     selectionValid: boolean,
 *   }) => void,
 * }} options
 * @returns {ReturnType<typeof mountSubscriptionOnPdp>}
 */
function mountProductDetailsSubscription(options) {
  return mountSubscriptionOnPdp(options);
}

/**
 * One call for merchant PDP / mini-PDP: mount UI + keep cart button validity in sync.
 *
 * @param {ProductDetailsSubscriptionRoots & {
 *   scope?: string,
 *   initialSelection?: import('../contract.js').SubscriptionSelection,
 *   onChange?: Function,
 * }} options
 *   `onChange` is called after every render with `meta.visible` (RecurBuy has
 *   something to show) — the host mounts its roots only while that is true.
 */
export function attachPdpSubscription(options) {
  const { onChange, ...mountOptions } = options;

  /** @type {{ setProps: Function }|null} */
  let buttonRef = null;
  /** @type {ReturnType<typeof mountSubscriptionOnPdp>|null} */
  let controller = null;

  const validity = createCartActionValidityBridge({
    getButton: () => buttonRef,
    getSubscriptionController: () => controller,
  });

  controller = mountProductDetailsSubscription({
    ...mountOptions,
    onChange: (selection, meta) => {
      // Styles are fetched only once there is RecurBuy UI to style.
      if (meta.visible) ensureRecurBuyStyles();
      validity.onSubscriptionChange(selection, meta);
      onChange?.(selection, meta);
    },
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
 * Keeps the Add/Update button disabled while a RecurBuy subscription is chosen
 * but incomplete. The native button state is otherwise never written: a
 * product without an active subscription leaves the host's button alone.
 *
 * @param {{
 *   getSubscriptionController: () => { isSelectionValid: () => boolean }|null|undefined,
 *   getButton: () => { setProps: Function }|null|undefined,
 * }} options
 */
function createCartActionValidityBridge(options) {
  const { getSubscriptionController, getButton } = options;

  let productValid = true;
  let disabledByUs = false;

  /** @param {boolean} disabled */
  const writeDisabled = (disabled) => {
    getButton()?.setProps((prev) => ({ ...prev, disabled }));
  };

  const sync = () => {
    if (!getButton()) return;
    // `isSelectionValid` is false only for an active, incomplete subscription.
    const incomplete = getSubscriptionController()?.isSelectionValid() === false;
    if (incomplete) {
      disabledByUs = true;
      writeDisabled(true);
      return;
    }
    if (!disabledByUs) return;
    // Hand the button back in the state the host's own validity implies.
    disabledByUs = false;
    writeDisabled(!productValid);
  };

  return {
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
