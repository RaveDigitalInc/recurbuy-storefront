/**
 * Cart / mini-cart / checkout subscription UI without patching stock blocks.
 * Listens to cart/data and paints into Adobe drop-in DOM.
 */

import { events } from '@dropins/tools/event-bus.js';
import { getCartDataFromCache } from '@dropins/storefront-cart/api.js';
import { formatBillingCycle, formatMoney } from '../format.js';
import {
  getVisibleCartLineAttributes,
  formatCartAttributeLabel,
  getSubscriptionOptionIdFromCartItem,
} from '../cart-line-custom-attributes.js';
import { renderCustomAttributes } from '../helpers/custom-attributes.js';
import { hideAccsCartMergeOptionConfigurations } from '../helpers/hide-accs-merge-option.js';
import { ensureRecurBuyStyles } from '../helpers/ensure-styles.js';
import {
  clearCartSubscriptionDetails,
  paintMiniCartSubscriptionPrices,
  renderCartSubscriptionDetails,
} from '../cart-subscription-details.js';
import { createCartDetailsStore } from './cart-details-store.js';

/**
 * @typedef {import('../cart-subscription-details.js').CartSubscriptionDetails} CartDetails
 * @typedef {Map<string, CartDetails>} DetailsMap
 */

const RUNTIME_ATTRS_CLASS = 'recurbuy-runtime-attrs';
const RUNTIME_SUMMARY_CLASS = 'recurbuy-order-summary-runtime';
const ROW_UID_RE = /^cart-list-item-entry-(.+)$/;

/** @type {boolean} */
let installed = false;

/**
 * @param {Element} row
 * @returns {string}
 */
function rowUid(row) {
  const testId = row.getAttribute('data-testid') || '';
  const match = ROW_UID_RE.exec(testId);
  return match?.[1] || '';
}

/**
 * @param {Element} row
 * @param {object|null|undefined} item
 * @param {CartDetails|null|undefined} details
 * @param {'cart'|'mini'} variant
 */
function paintRowAttributes(row, item, details, variant) {
  const anchor = row.querySelector('.dropin-cart-item__attributes')
    || row.querySelector('[data-slot="ProductAttributes"]')
    || row;

  let host = row.querySelector(`.${RUNTIME_ATTRS_CLASS}`);
  if (!(host instanceof HTMLElement)) {
    host = document.createElement('div');
    host.className = RUNTIME_ATTRS_CLASS;
    anchor.appendChild(host);
  }

  host.replaceChildren();

  const lineAttributes = getVisibleCartLineAttributes(item).map((attribute) => ({
    code: formatCartAttributeLabel(attribute.code),
    value: attribute.value,
  }));
  if (lineAttributes.length) {
    const lineWrapper = document.createElement('div');
    renderCustomAttributes(lineWrapper, lineAttributes, 'cart');
    lineWrapper.classList.add('custom-attrs--cart-line');
    host.appendChild(lineWrapper);
  }

  const detailsRoot = document.createElement('div');
  host.appendChild(detailsRoot);
  if (details?.purchaseType === 'subscription') {
    renderCartSubscriptionDetails(detailsRoot, details, { variant });
  } else {
    clearCartSubscriptionDetails(detailsRoot);
  }
}

/**
 * Full cart page prices (same selectors as mini-cart rows).
 * @param {Array<object>|null|undefined} items
 * @param {DetailsMap} detailsByUid
 */
function paintFullCartPrices(items, detailsByUid) {
  document.querySelectorAll('.cart__list .dropin-cart-item, .commerce-cart .dropin-cart-item')
    .forEach((row) => {
      const uid = rowUid(row);
      const item = uid ? (items || []).find((entry) => entry?.uid === uid) : null;
      const details = uid ? detailsByUid.get(uid) : null;
      const price = row.querySelector('.dropin-cart-item__price');
      const total = row.querySelector('.dropin-cart-item__total');
      if (!details || details.purchaseType !== 'subscription' || !details.price) {
        return;
      }
      const label = formatMoney(details.price);
      if (price instanceof HTMLElement && label) {
        price.querySelectorAll('.dropin-price').forEach((node) => {
          node.textContent = label;
        });
        if (!price.querySelector('.dropin-price')) {
          price.textContent = label;
        }
      }
      const quantity = Number(item?.quantity) || 1;
      if (total instanceof HTMLElement) {
        if (quantity > 1 && label) {
          const totalLabel = formatMoney({
            value: details.price.value * quantity,
            currency: details.price.currency,
          });
          total.hidden = false;
          total.querySelectorAll('.dropin-price').forEach((node) => {
            node.textContent = totalLabel;
          });
        } else {
          total.hidden = true;
        }
      }
    });
}

/**
 * Checkout CartSummaryList rows live outside `.cart__list`.
 * @param {Array<object>|null|undefined} items
 * @param {DetailsMap} detailsByUid
 */
function paintCheckoutRows(items, detailsByUid) {
  document.querySelectorAll(
    '.commerce-checkout .dropin-cart-item, [class*="checkout"] .dropin-cart-item',
  ).forEach((row) => {
    if (row.closest('.cart-mini-cart') || row.closest('.cart__list')) return;
    const uid = rowUid(row);
    const item = uid ? (items || []).find((entry) => entry?.uid === uid) : null;
    const details = uid ? detailsByUid.get(uid) : null;
    paintRowAttributes(row, item, details, 'cart');
  });
}

/**
 * @param {Array<object>|null|undefined} items
 * @param {DetailsMap} detailsByUid
 * @param {Record<string, unknown>|null} checkoutConfig
 */
function paintOrderSummary(items, detailsByUid, checkoutConfig) {
  const host = document.querySelector('.cart__order-summary');
  if (!(host instanceof HTMLElement)) return;

  const subscriptionItems = (items || []).filter((item) => (
    getSubscriptionOptionIdFromCartItem(item)
    || detailsByUid.get(item?.uid)?.purchaseType === 'subscription'
  ));

  let box = host.querySelector(`.${RUNTIME_SUMMARY_CLASS}`);
  if (!subscriptionItems.length) {
    box?.remove();
    return;
  }

  if (!(box instanceof HTMLElement)) {
    box = document.createElement('div');
    box.className = RUNTIME_SUMMARY_CLASS;
    host.appendChild(box);
  }

  const payNow = checkoutConfig?.awSarp2GrandTotalYouPayNow || 'You pay now';
  const chargedFor = checkoutConfig?.awSarp2GrandTotalBasicCurrencyMessage
    || 'You will be charged for';

  let currency = '';
  let value = 0;
  let period = null;
  const complete = subscriptionItems.every((item) => {
    const details = detailsByUid.get(item?.uid);
    if (!details?.price || typeof details.price.value !== 'number') return false;
    if (currency && details.price.currency !== currency) return false;
    currency = details.price.currency;
    value += details.price.value * (Number(item.quantity) || 1);
    period = period || details.period;
    return true;
  });

  const cycle = complete ? formatBillingCycle(period) : '';
  const amount = complete && currency
    ? formatMoney({ value: Math.round(value * 100) / 100, currency })
    : '';

  box.innerHTML = `
    <div class="cart-order-summary__pay-now"><span class="subscription-pay-now">${payNow}</span></div>
    ${amount ? `<div class="cart-order-summary__charged-for subscription-charged-for">${chargedFor} <strong>${amount}${cycle ? ` / ${cycle}` : ''}</strong></div>` : ''}
  `;
}

/**
 * @param {object|null|undefined} cartData
 * @param {ReturnType<typeof createCartDetailsStore>} session
 */
async function paintFromCart(cartData, session) {
  const items = cartData?.items || getCartDataFromCache()?.items || [];
  await session.syncFromCartData(cartData);

  document.querySelectorAll('.dropin-cart-item').forEach((row) => {
    const uid = rowUid(row);
    const item = uid ? items.find((entry) => entry?.uid === uid) : null;
    const details = uid ? session.detailsByUid.get(uid) : null;
    const variant = row.closest('.cart-mini-cart') ? 'mini' : 'cart';
    paintRowAttributes(row, item, details, variant);
  });

  paintMiniCartSubscriptionPrices(items, session.detailsByUid);
  paintFullCartPrices(items, session.detailsByUid);
  paintCheckoutRows(items, session.detailsByUid);
  paintOrderSummary(items, session.detailsByUid, session.getCheckoutConfig());

  hideAccsCartMergeOptionConfigurations(document);
  requestAnimationFrame(() => hideAccsCartMergeOptionConfigurations(document));
}

/**
 * Install once per page. Safe on pages without cart UI.
 */
export function installCartUiRuntime() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  ensureRecurBuyStyles();

  const session = createCartDetailsStore({
    getCartItems: () => getCartDataFromCache()?.items || [],
  });

  const run = (cartData) => {
    paintFromCart(cartData, session).catch((error) => {
      console.error('RecurBuy cart UI runtime failed:', error);
    });
  };

  // Drop-in re-renders after cart/data; paint again on the next frames.
  events.on('cart/data', (cartData) => {
    run(cartData);
    requestAnimationFrame(() => {
      run(cartData);
      requestAnimationFrame(() => run(cartData));
    });
  }, { eager: true });

  // The mini-cart renders its rows when it is first opened, after the last
  // cart/data. Paint again whenever new cart rows appear in the document.
  let scheduled = false;
  const hasAddedCartRow = (mutations) => mutations.some(({ addedNodes }) => (
    [...addedNodes].some((node) => node instanceof Element
      && (node.matches('.dropin-cart-item') || node.querySelector('.dropin-cart-item')))
  ));
  new MutationObserver((mutations) => {
    if (scheduled || !hasAddedCartRow(mutations)) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run(null);
    });
  }).observe(document.body, { childList: true, subtree: true });
}
