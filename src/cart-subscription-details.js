import {
  loadQuoteSubscriptionMarkers,
  subscriptionDetailsFromQuoteMarker,
} from './adapters/quote-subscription-markers.js';
import { fetchSubscriptionOptionList } from './adapters/storefront-options-list.js';
import { isPlaceholderPlanLabel } from './adapters/storefront-cart-items-mapper.js';
import { formatBillingCycle, formatMoney } from './format.js';
import {
  getSelectionForCartItem,
  pruneSelectionsToCartItems,
  saveSelectionForUid,
} from './selection-store.js';
import { getSubscriptionStartDateFromCartItem } from './cart-line-custom-attributes.js';

/**
 * @typedef {import('./contract.js').CartSubscriptionDetails} CartSubscriptionDetails
 */

/** @type {Promise<Map<string, CartSubscriptionDetails>>|null} */
let syncInflight = null;

/**
 * Renders subscription details for a cart item.
 * @param {HTMLElement} root
 * @param {CartSubscriptionDetails|null|undefined} details
 */
export function renderCartSubscriptionDetails(root, details, options = {}) {
  if (!root) return;

  const variant = options.variant === 'mini' ? 'mini' : 'cart';
  root.className = variant === 'mini'
    ? 'cart-subscription-details cart-subscription-details--compact'
    : 'cart-subscription-details';

  if (!details || details.purchaseType !== 'subscription') {
    clearCartSubscriptionDetails(root);
    return;
  }

  const facts = renderSubscriptionFacts(details, { includePlan: variant === 'mini' });
  root.hidden = false;
  root.innerHTML = variant === 'mini'
    ? `
      <div class="cart-subscription-details__content">
        <span class="cart-subscription-details__badge">Subscription</span>
        <details class="cart-subscription-details__disclosure">
          <summary class="cart-subscription-details__summary">See Details</summary>
          ${facts}
        </details>
      </div>
    `
    : `
      <div class="cart-subscription-details__content">
        ${facts}
      </div>
    `;
}

/**
 * @param {HTMLElement} root
 */
export function clearCartSubscriptionDetails(root) {
  if (!root) return;
  root.className = 'cart-subscription-details';
  root.hidden = true;
  root.innerHTML = '';
}

/**
 * Optimistic paint from the in-memory add cache (same document only).
 * Prefer `syncCartSubscriptionDetails` / quote attrs for durable details.
 *
 * @param {{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 *   customFields?: Record<string, unknown>,
 * }|null|undefined} item
 * @returns {CartSubscriptionDetails|null}
 */
function fetchCartItemSubscriptionDetails(item) {
  if (!item) return null;

  const selection = getSelectionForCartItem(item);
  if (!selection || selection.purchaseType !== 'subscription' || !selection.planId) {
    return null;
  }

  if (item.uid) {
    saveSelectionForUid(item.uid, selection);
  }

  const snapshot = selection.planSnapshot;
  if (!snapshot) {
    return null;
  }

  const startDateFromCart = getSubscriptionStartDateFromCartItem(item);

  return {
    purchaseType: 'subscription',
    planId: selection.planId,
    planLabel: snapshot.planLabel || `Plan ${selection.planId}`,
    period: snapshot.period || { value: 1, unit: 'month' },
    price: snapshot.price || { value: 0, currency: 'USD' },
    startDate: snapshot.startDate || startDateFromCart || undefined,
    ...(snapshot.endsLabel ? { endsLabel: snapshot.endsLabel } : {}),
  };
}

/**
 * Syncs local cart subscription state from cart events / cart data.
 * @param {Array<{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 *   customFields?: Record<string, unknown>,
 * }>|null|undefined} items
 * @param {Map<string, CartSubscriptionDetails>} detailsByUid
 * @returns {Promise<Map<string, CartSubscriptionDetails>>}
 */
export async function syncCartSubscriptionDetails(items, detailsByUid = new Map()) {
  // Mini-cart and cart page both listen to cart/data — one sync is enough.
  if (syncInflight) {
    const shared = await syncInflight;
    return new Map(shared);
  }

  syncInflight = runCartSubscriptionSync(items, detailsByUid).finally(() => {
    syncInflight = null;
  });

  return syncInflight;
}

/**
 * @param {Array<{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 *   customFields?: Record<string, unknown>,
 * }>|null|undefined} items
 * @param {Map<string, CartSubscriptionDetails>} detailsByUid
 * @returns {Promise<Map<string, CartSubscriptionDetails>>}
 */
async function runCartSubscriptionSync(items, detailsByUid) {
  const next = new Map(detailsByUid);
  const list = items || [];

  pruneSelectionsToCartItems(list);

  // AccS guest carts: do not call GET …/checkout/cart-items (REST 404 on masked
  // guest carts). Presentation lives on quote custom_attributes; options-list
  // only backfills titles for lines stamped before plan_label existed.
  const quoteMarkers = await loadQuoteSubscriptionMarkers((await resolveCommerceCartId()) || '');

  const titleProductIds = new Set();
  const resolved = await Promise.all(list.map(async (item) => {
    if (!item?.uid) return null;

    const marker = quoteMarkers.get(item.uid);
    const quoteDetails = marker ? await subscriptionDetailsFromQuoteMarker(marker) : null;
    // Same-document optimistic cache only — never a durable SoR.
    const optimistic = fetchCartItemSubscriptionDetails(item);
    const details = mergeQuoteDetailsWithSnapshot(quoteDetails, optimistic);

    if (details && isPlaceholderPlanLabel(details.planLabel) && marker?.catalogProductId) {
      titleProductIds.add(String(marker.catalogProductId));
    }

    return { item, marker, details };
  }));

  /** @type {Map<string, Record<string, string>>} */
  const titlesByProductId = new Map();
  if (titleProductIds.size > 0) {
    await Promise.all([...titleProductIds].map(async (productId) => {
      const optionList = await fetchSubscriptionOptionList(productId);
      titlesByProductId.set(productId, optionList?.titles || {});
    }));
  }

  resolved.forEach((entry) => {
    if (!entry?.item?.uid) return;

    let { details } = entry;
    if (details && isPlaceholderPlanLabel(details.planLabel) && entry.marker?.catalogProductId) {
      const title = titlesByProductId
        .get(String(entry.marker.catalogProductId))?.[String(details.planId)];
      if (title) {
        details = { ...details, planLabel: title };
      }
    }

    if (details) {
      rememberQuoteSelection(entry.item, details);
      next.set(entry.item.uid, details);
    } else {
      // One-time (or unmarked) line — do not copy a prior bySku plan onto this uid.
      next.delete(entry.item.uid);
    }
  });

  // Drop entries for removed items
  const liveUids = new Set(list.map((item) => item?.uid).filter(Boolean));
  [...next.keys()].forEach((uid) => {
    if (!liveUids.has(uid)) next.delete(uid);
  });

  return next;
}

/**
 * Keep the in-memory add cache aligned with quote details for slot paints
 * that run before the next sync in this document.
 *
 * @param {{ uid?: string, sku?: string, topLevelSku?: string }} item
 * @param {CartSubscriptionDetails} details
 */
function rememberQuoteSelection(item, details) {
  const selection = {
    purchaseType: 'subscription',
    planId: details.planId,
    planSnapshot: {
      planLabel: details.planLabel,
      period: details.period,
      price: details.price,
      ...(details.startDate ? { startDate: details.startDate } : {}),
      ...(details.endsLabel ? { endsLabel: details.endsLabel } : {}),
    },
  };

  // Quote attrs are SoR; only bind the line uid so a later one-time add of the
  // same SKU is not painted from bySku.
  if (item.uid) saveSelectionForUid(item.uid, selection);
}

/**
 * Quote attrs win. In-memory optimistic details fill only the gap before attrs land.
 *
 * @param {CartSubscriptionDetails|null} quoteDetails
 * @param {CartSubscriptionDetails|null} optimistic
 * @returns {CartSubscriptionDetails|null}
 */
function mergeQuoteDetailsWithSnapshot(quoteDetails, optimistic) {
  if (!quoteDetails) return optimistic;
  if (!optimistic || optimistic.purchaseType !== 'subscription') return quoteDetails;

  const keepOptimisticLabel = isPlaceholderPlanLabel(quoteDetails.planLabel)
    && !isPlaceholderPlanLabel(optimistic.planLabel);

  // Magento quote unit is SoR when it matches the plan. AccS dynamic bundles often
  // skip selection save_before after a one-time of the same picks, so GraphQL
  // prices.price stays the catalog/sale child sum while the plan unit is half of
  // link. Prefer same-document snapshot, else quoteDetails already prefers stamped
  // recurbuy_plan_unit when Magento looks like catalog.
  const magentoPrice = quoteDetails.price;
  const planPrice = optimistic.price;
  const magentoValue = typeof magentoPrice?.value === 'number' ? magentoPrice.value : null;
  const planValue = typeof planPrice?.value === 'number' ? planPrice.value : null;
  const magentoLooksLikeCatalog = planValue != null
    && magentoValue != null
    && planValue > 0
    && magentoValue > planValue * 1.15;

  return {
    ...quoteDetails,
    planLabel: keepOptimisticLabel ? optimistic.planLabel : quoteDetails.planLabel,
    period: quoteDetails.period || optimistic.period,
    endsLabel: quoteDetails.endsLabel || optimistic.endsLabel,
    startDate: quoteDetails.startDate || optimistic.startDate,
    price: magentoLooksLikeCatalog
      ? planPrice
      : (magentoPrice || planPrice),
  };
}

/**
 * @returns {Promise<string|null>}
 */
async function resolveCommerceCartId() {
  try {
    const cartApi = await import('@dropins/storefront-cart/api.js');
    const cachedCart = cartApi.getCartDataFromCache?.();
    const cartId = cartApi.config?.cartId || cachedCart?.id;
    return typeof cartId === 'string' && cartId.trim() ? cartId.trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {CartSubscriptionDetails} details
 * @param {{ includePlan?: boolean }} [options]
 * @returns {string}
 */
function renderSubscriptionFacts(details, options = {}) {
  const cycle = formatBillingCycle(details.period);
  const amount = details.price ? formatMoney(details.price) : '';
  const payment = amount && cycle ? `${amount} / ${cycle}` : amount;
  const startLabel = formatStartDate(details.startDate);
  const planLabel = options.includePlan && !isPlaceholderPlanLabel(details.planLabel)
    ? details.planLabel
    : '';
  const endsLabel = details.endsLabel || 'Cancel Anytime';

  return `
    <dl class="cart-subscription-details__list">
      ${planLabel ? `
        <div class="cart-subscription-details__row">
          <dt class="cart-subscription-details__label">Subscription Plan</dt>
          <dd class="cart-subscription-details__value">${escapeHtml(planLabel)}</dd>
        </div>
      ` : ''}
      ${payment ? `
        <div class="cart-subscription-details__row">
          <dt class="cart-subscription-details__label">Regular Payments</dt>
          <dd class="cart-subscription-details__value">
            <span>${escapeHtml(payment)}</span>
            ${startLabel ? `<span class="cart-subscription-details__note">starting ${escapeHtml(startLabel)}</span>` : ''}
          </dd>
        </div>
      ` : ''}
      <div class="cart-subscription-details__row">
        <dt class="cart-subscription-details__label">Subscription End Date</dt>
        <dd class="cart-subscription-details__value">${escapeHtml(endsLabel)}</dd>
      </div>
    </dl>
  `;
}

/**
 * @param {string|undefined} startDate
 * @returns {string}
 */
function formatStartDate(startDate) {
  if (!startDate) return '';
  // Quote flags already localize dates ("9/15/26"). Reparsing those shifts the year.
  if (!/^\d{4}-\d{2}-\d{2}/.test(startDate)) return startDate;
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return startDate;

  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
  } catch {
    return startDate;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One-time lines keep the drop-in price. Subscription lines show the plan price.
 * @param {Array<{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 *   quantity?: number,
 * }>|null|undefined} items
 * @param {Map<string, CartSubscriptionDetails>} detailsByUid
 */
export function paintMiniCartSubscriptionPrices(items, detailsByUid) {
  const rows = document.querySelectorAll('.cart-mini-cart .dropin-cart-item');
  rows.forEach((row) => {
    // Bundle (and other) lines can share the same displayed SKU. AccS rows are
    // tagged `cart-list-item-entry-{uid}` — that uid is the cart line identity.
    const rowUid = miniCartRowUid(row);
    const item = rowUid
      ? (items || []).find((entry) => entry?.uid === rowUid)
      : null;
    const details = item?.uid ? detailsByUid.get(item.uid) : null;
    const total = row.querySelector('.dropin-cart-item__total');
    const price = row.querySelector('.dropin-cart-item__price');

    if (!details || details.purchaseType !== 'subscription' || !details.price) {
      restoreMiniCartPrice(row);
      return;
    }

    replaceDisplayedPrice(price, formatMoney(details.price));
    hideOneTimePrices(row);

    if (!(total instanceof HTMLElement)) return;

    const quantity = Number(item?.quantity) || 1;
    if (quantity > 1) {
      showMiniCartTotal(total);
      const saleTotal = total.querySelector('[data-testid="discount-total"]') || total;
      replaceDisplayedPrice(saleTotal, formatMoney({
        value: details.price.value * quantity,
        currency: details.price.currency,
      }));
      return;
    }

    total.hidden = true;
    total.style.display = 'none';
    total.dataset.subscriptionHidden = 'true';
  });

  paintMiniCartSubtotal(items, detailsByUid);
}

/**
 * @param {Element} row
 * @returns {string}
 */
function miniCartRowUid(row) {
  const testId = row.getAttribute('data-testid') || '';
  const match = /^cart-list-item-entry-(.+)$/.exec(testId);
  return match?.[1] || '';
}

/**
 * AccS addProductsToCart cannot carry the subscription option (string entered_options
 * are rejected). The first cart payload therefore still has the catalog subtotal.
 * The line price is already the plan amount; keep the footer on that amount too.
 *
 * @param {Array<{
 *   uid?: string,
 *   quantity?: number,
 *   price?: { value?: number, currency?: string },
 *   regularPrice?: { value?: number, currency?: string },
 * }>|null|undefined} items
 * @param {Map<string, CartSubscriptionDetails>} detailsByUid
 */
function paintMiniCartSubtotal(items, detailsByUid) {
  const amount = subscriptionAdjustedSubtotal(items, detailsByUid);
  if (!amount) return;

  const label = formatMoney(amount);
  if (!label) return;

  document.querySelectorAll([
    '.cart-mini-cart [data-testid="subtotal-including-tax"]',
    '.cart-mini-cart [data-testid="subtotal-excluding-tax"]',
    '.cart-mini-cart [data-testid="subtotal-including-excluding-tax"]',
  ].join(', ')).forEach((node) => {
    if (node.childElementCount === 0) {
      node.textContent = label;
      return;
    }
    replaceDisplayedPrice(node, label);
  });
}

/**
 * @param {Array<{
 *   uid?: string,
 *   quantity?: number,
 *   price?: { value?: number, currency?: string },
 *   regularPrice?: { value?: number, currency?: string },
 * }>|null|undefined} items
 * @param {Map<string, CartSubscriptionDetails>} detailsByUid
 * @returns {import('./contract.js').MoneyAmount|null}
 */
function subscriptionAdjustedSubtotal(items, detailsByUid) {
  const list = items || [];
  if (list.length === 0) return null;

  let currency = 'USD';
  let sum = 0;
  let adjusted = false;
  let incomplete = false;

  list.forEach((item) => {
    if (incomplete) return;

    const quantity = Number(item?.quantity) > 0 ? Number(item.quantity) : 1;
    const details = item?.uid ? detailsByUid.get(item.uid) : null;
    if (details?.purchaseType === 'subscription' && typeof details.price?.value === 'number') {
      sum += details.price.value * quantity;
      currency = details.price.currency || currency;
      adjusted = true;
      return;
    }

    const unit = typeof item?.price?.value === 'number'
      ? item.price.value
      : item?.regularPrice?.value;
    if (typeof unit !== 'number') {
      incomplete = true;
      return;
    }

    sum += unit * quantity;
    currency = item?.price?.currency || item?.regularPrice?.currency || currency;
  });

  if (incomplete || !adjusted) return null;

  return {
    value: Math.round(sum * 100) / 100,
    currency,
  };
}

/**
 * Drop-in shows the catalog price beside the charged price when they differ.
 * Mini-cart keeps the subscription amount only.
 * @param {Element} row
 */
function hideOneTimePrices(row) {
  row.querySelectorAll('.dropin-price--strikethrough').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.hidden = true;
    node.dataset.subscriptionHidden = 'true';
  });
}

/**
 * @param {HTMLElement} total
 */
function showMiniCartTotal(total) {
  total.hidden = false;
  total.style.removeProperty('display');
  delete total.dataset.subscriptionHidden;
}

/**
 * @param {Element} row
 */
function restoreMiniCartPrice(row) {
  const total = row.querySelector('.dropin-cart-item__total');
  if (total instanceof HTMLElement && total.dataset.subscriptionHidden === 'true') {
    showMiniCartTotal(total);
  }

  row.querySelectorAll('[data-subscription-hidden="true"]').forEach((node) => {
    if (!(node instanceof HTMLElement) || node === total) return;
    node.hidden = false;
    delete node.dataset.subscriptionHidden;
  });
}

/**
 * @param {Element|null} container
 * @param {string} label
 */
function replaceDisplayedPrice(container, label) {
  if (!container || !label) return;

  const quantity = container.querySelector('.dropin-cart-item__price__quantity');
  const priceNodes = [...container.querySelectorAll('.dropin-price')]
    .filter((node) => node !== quantity && !quantity?.contains(node));
  if (priceNodes.length) {
    priceNodes.forEach((node) => {
      node.textContent = label;
    });
    return;
  }

  const leaf = [...container.querySelectorAll('span, div')].find((node) => (
    node !== quantity
    && !quantity?.contains(node)
    && node.childElementCount === 0
    && /\d/.test(node.textContent || '')
  ));
  if (leaf) {
    leaf.textContent = label;
    return;
  }

  let sibling = quantity?.nextSibling;
  while (sibling) {
    if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent?.trim()) {
      sibling.textContent = ` ${label}`;
      return;
    }
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      sibling.textContent = label;
      return;
    }
    sibling = sibling.nextSibling;
  }

  const money = /[$€£¥]\s?[\d.,]+/;
  [...container.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && money.test(node.textContent || '')) {
      node.textContent = node.textContent.replace(money, label);
    }
  });
}

/**
 * Writes the subscription amount into the slot's own price node.
 * `replaceWith` on the slot element pulls that cell out of the table grid and,
 * on the next refresh, leaves a second price behind.
 * @param {HTMLElement} ctx
 * @param {{ className: string, label: string, ariaLabel: string }} paint
 */
