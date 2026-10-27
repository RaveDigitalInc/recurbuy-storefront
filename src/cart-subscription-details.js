import {
  loadQuoteSubscriptionMarkers,
  peekCapturedQuoteMarkers,
  subscriptionDetailsFromQuoteMarker,
} from './adapters/quote-subscription-markers.js';
import { fetchSubscriptionOptionList } from './adapters/storefront-options-list.js';
import { isPlaceholderPlanLabel } from './adapters/storefront-cart-items-mapper.js';
import { formatBillingCycle, formatMoney } from './format.js';
import { isCatalogDrift } from './plan-price.js';
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
  const quoteMarkers = peekCapturedQuoteMarkers(list)
    ?? await loadQuoteSubscriptionMarkers((await resolveCommerceCartId()) || '');

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
  const magentoLooksLikeCatalog = isCatalogDrift(magentoValue, planValue);

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
