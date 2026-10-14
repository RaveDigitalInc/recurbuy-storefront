import { ACCS_CART_MERGE_OPTION_SKU } from '../contract.js';

/** Magento Admin option title from AccsCartMergeOptionEnsurer. */
const ACCS_CART_MERGE_OPTION_TITLE = 'RecurBuy subscription';

/**
 * Hide AccS native customizable-option UI for the RecurBuy cart merge-key field.
 * The field exists so GraphQL entered_options can separate subscription lines
 * from one-time lines; it is not a shopper input (SARP addCustomOption parity).
 *
 * @param {ParentNode|null|undefined} [root]
 */
export function hideAccsCartMergeOptionElements(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const nodes = root.querySelectorAll('label, legend, span, p, div');
  nodes.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const text = (el.textContent || '').trim();
    const isMergeTitle = text === ACCS_CART_MERGE_OPTION_TITLE;
    const isMergeSku = text.toLowerCase() === ACCS_CART_MERGE_OPTION_SKU;
    if (!isMergeTitle && !isMergeSku) {
      return;
    }
    const container = el.closest(
      '[class*="option"], fieldset, [data-sku], .dropin-product-details__option, .product-details__options > *',
    ) || el.parentElement;
    if (container instanceof HTMLElement) {
      container.hidden = true;
      container.setAttribute('data-recurbuy-merge-option', 'hidden');
    }
  });
}

/**
 * AccS CartItem renders customizableOptions as {@code Label: value} list items.
 * The merge-key option ("RecurBuy subscription: 14") is internal — hide those rows.
 *
 * @param {ParentNode|null|undefined} [root]
 */
export function hideAccsCartMergeOptionConfigurations(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const title = ACCS_CART_MERGE_OPTION_TITLE.toLowerCase();
  const sku = ACCS_CART_MERGE_OPTION_SKU.toLowerCase();

  root.querySelectorAll('.dropin-cart-item__configurations__item').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const text = (el.textContent || '').trim().toLowerCase();
    if (!text.startsWith(title) && !text.startsWith(sku)) {
      return;
    }
    el.hidden = true;
    el.setAttribute('data-recurbuy-merge-option', 'hidden');
  });
}
