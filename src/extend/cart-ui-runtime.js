/**
 * Cart / mini-cart / checkout subscription UI without patching stock blocks.
 * Listens to cart/data and paints into Adobe drop-in DOM.
 *
 * Add-on contract: acts only on RecurBuy lines. Without a RecurBuy line in the
 * cart it touches nothing except our own previously painted nodes and makes no
 * network request; rows of other lines never get a RecurBuy node.
 */

import { events } from '@dropins/tools/event-bus.js';
import { getCartDataFromCache } from '@dropins/storefront-cart/api.js';
import { formatBillingCycle, formatMoney } from '../format.js';
import { ensureRecurBuyStyles } from '../helpers/ensure-styles.js';
import { renderCartSubscriptionDetails } from '../cart-subscription-details.js';
import { hasRecurbuyLines } from '../recurbuy-line.js';
import {
  planRowPaint,
  resolveCartPaintScope,
  rowUidFromTestId,
} from '../cart-ui-scope.js';
import { createCartDetailsStore } from './cart-details-store.js';

/**
 * @typedef {import('../cart-subscription-details.js').CartSubscriptionDetails} CartDetails
 * @typedef {Map<string, CartDetails>} DetailsMap
 */

const RUNTIME_ATTRS_CLASS = 'recurbuy-runtime-attrs';
const RUNTIME_SUMMARY_CLASS = 'recurbuy-order-summary-runtime';

/**
 * @param {Element} row
 * @returns {string}
 */
function rowUid(row) {
  return rowUidFromTestId(row.getAttribute('data-testid'));
}

/**
 * @param {Element} row
 */
function removeOwnRowHost(row) {
  row.querySelector(`.${RUNTIME_ATTRS_CLASS}`)?.remove();
}

/**
 * @param {Element} row a row of a RecurBuy line
 * @param {CartDetails} details subscription details of that line
 * @param {'cart'|'mini'} variant
 */
function paintRowDetails(row, details, variant) {
  ensureRecurBuyStyles();
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
  const detailsRoot = document.createElement('div');
  host.appendChild(detailsRoot);
  renderCartSubscriptionDetails(detailsRoot, details, { variant });
}

/**
 * @param {Array<object>|null|undefined} items
 * @param {import('../cart-ui-scope.js').CartPaintScope} scope
 * @param {DetailsMap} detailsByUid
 * @param {Record<string, unknown>|null} checkoutConfig
 */
function paintOrderSummary(items, scope, detailsByUid, checkoutConfig) {
  const host = document.querySelector('.cart__order-summary');
  if (!(host instanceof HTMLElement)) return;

  const subscriptionItems = (items || []).filter((item) => scope.ownedUids.has(item?.uid));

  let box = host.querySelector(`.${RUNTIME_SUMMARY_CLASS}`);
  if (!subscriptionItems.length) {
    box?.remove();
    return;
  }

  if (!(box instanceof HTMLElement)) {
    ensureRecurBuyStyles();
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
 * @param {{
 *   isActive: () => boolean,
 *   getCartData: () => object|null|undefined,
 * }} deps `isActive` is false once the runtime is disposed mid-flight
 */
async function paintFromCart(cartData, session, { isActive, getCartData }) {
  const items = cartData?.items || getCartData()?.items || [];
  const scope = resolveCartPaintScope(items);
  if (!scope.active) {
    clearPaintedRuntimeNodes();
    return;
  }

  await session.syncFromCartData(cartData);
  if (!isActive()) return;

  document.querySelectorAll('.dropin-cart-item').forEach((row) => {
    const uid = rowUid(row);
    const details = uid ? session.detailsByUid.get(uid) : null;
    if (planRowPaint(scope, uid, details) === 'paint') {
      paintRowDetails(row, details, row.closest('.cart-mini-cart') ? 'mini' : 'cart');
    } else {
      removeOwnRowHost(row);
    }
  });

  paintOrderSummary(items, scope, session.detailsByUid, session.getCheckoutConfig());
}

/**
 * Remove everything this runtime painted into the drop-in DOM.
 */
function clearPaintedRuntimeNodes() {
  document.querySelectorAll(`.${RUNTIME_ATTRS_CLASS}, .${RUNTIME_SUMMARY_CLASS}`)
    .forEach((node) => node.remove());
}

/**
 * Safe on pages without cart UI.
 *
 * @param {{ getCartData?: () => object|null|undefined }} [options]
 *   `getCartData` reads the cart drop-in's cached cart (injectable for tests)
 * @returns {() => void} dispose — stops listeners/observer and removes painted nodes
 */
export function installCartUiRuntime({ getCartData = getCartDataFromCache } = {}) {
  if (typeof document === 'undefined') return () => {};

  let disposed = false;
  const session = createCartDetailsStore({
    getCartItems: () => getCartData()?.items || [],
  });

  const run = (cartData) => {
    if (disposed) return;
    paintFromCart(cartData, session, {
      isActive: () => !disposed,
      getCartData,
    }).catch((error) => {
      console.error('RecurBuy cart UI runtime failed:', error);
    });
  };

  // Drop-in re-renders after cart/data; paint again on the next frames — but
  // only for a cart that has RecurBuy lines.
  const dataListener = events.on('cart/data', (cartData) => {
    run(cartData);
    if (!hasRecurbuyLines(cartData?.items || getCartData()?.items)) return;
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
  const observer = new MutationObserver((mutations) => {
    if (scheduled || !hasAddedCartRow(mutations)) return;
    if (!hasRecurbuyLines(getCartData()?.items)) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run(null);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (disposed) return;
    disposed = true;
    dataListener.off();
    observer.disconnect();
    clearPaintedRuntimeNodes();
  };
}
