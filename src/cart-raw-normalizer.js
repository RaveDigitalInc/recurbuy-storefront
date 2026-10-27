/**
 * Pure GraphQL cart normaliser (no drop-in imports).
 *
 * Runs in the FetchGraphQL after-hook before the cart drop-in maps the
 * response: strip AccS merge customizable options, paint optimistic plan
 * units onto catalog-priced add payloads, and stamp quote markers onto
 * {@code custom_attributes} so the CartModel transformer can build
 * {@code item.recurbuy} without a side Map.
 *
 * Add-on contract: only RecurBuy lines are touched — a line carrying our
 * quote marker, or one being painted by the optimistic add path. Foreign lines
 * and foreign options (whatever their title or value) are left as received.
 */

import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from './contract.js';
import { cartLines } from './cart-lines.js';
import { isCartLineOptionConfiguration } from './helpers/cart-line-option-data.js';
import { lineOptionId } from './recurbuy-line.js';

/**
 * @typedef {{ value: number, currency?: string }} PlanUnit
 * @typedef {{
 *   uid?: string|null,
 *   planUnit?: PlanUnit|null,
 *   optionId?: string|number|null,
 * }} OptimisticLine
 */

/**
 * Normalise every GraphQL cart found under {@code response.data}.
 *
 * @param {unknown} data GraphQL {@code response.data}
 * @param {{ optimisticLines?: OptimisticLine[] }} [options]
 * @returns {unknown} same {@code data} reference (mutated in place)
 */
export function normalizeGraphqlCartData(data, options = {}) {
  const carts = collectGraphqlCarts(data);
  const optimisticLines = Array.isArray(options.optimisticLines)
    ? options.optimisticLines
    : [];

  carts.forEach((cart) => {
    stripMergeOptionsOnGraphqlCart(cart, optimisticLines);
    if (optimisticLines.length) {
      paintOptimisticPlanPricesOnGraphqlCart(cart, optimisticLines);
    }
  });

  return data;
}

/**
 * AccS {@code addProductsToCart} still returns catalog {@code prices.*}.
 * Paint the known PDP plan unit onto that GraphQL cart so the drop-in's first
 * MiniCart frame matches the plan. Also stamps plan markers onto
 * {@code custom_attributes} for the CartModel transformer.
 *
 * @param {unknown} cart GraphQL cart ({@code itemsV2.items} or {@code items})
 * @param {OptimisticLine[]} lines
 */
export function paintOptimisticPlanPricesOnGraphqlCart(cart, lines) {
  if (!cart || !Array.isArray(lines) || !lines.length) return;

  const items = cartLines(cart);
  if (!items.length) return;

  let painted = 0;
  lines.forEach(({ uid, planUnit, optionId }) => {
    if (typeof uid !== 'string' || !uid || !planUnit) return;
    const value = Number(planUnit.value);
    if (!Number.isFinite(value) || value < 0) return;

    const item = items.find((entry) => entry?.uid === uid);
    if (!item) return;

    const currency = typeof planUnit.currency === 'string' && planUnit.currency.trim()
      ? planUnit.currency.trim()
      : (item.prices?.price?.currency
        || item.prices?.original_item_price?.currency
        || 'USD');
    const qty = Number(item.quantity);
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const money = (amount) => ({ value: roundMoney(amount), currency });
    const row = value * quantity;

    if (!item.prices || typeof item.prices !== 'object') {
      item.prices = {};
    }
    // Drop-in unit = original_item_price (simple) / variant regular (configurable).
    // Line total paint uses original_row_total when not marked discounted.
    item.prices.price = money(value);
    item.prices.price_including_tax = money(value);
    item.prices.row_total = money(row);
    item.prices.row_total_including_tax = money(row);
    item.prices.original_item_price = money(value);
    item.prices.original_row_total = money(row);

    patchConfigurableVariantRegular(item, money(value));
    stripCartLineCustomizableOptionsOnGraphqlItem(item, optionId);
    stampOptimisticMarkersOnGraphqlItem(item, {
      planUnit: { value, currency },
      optionId,
    });
    painted += 1;
  });

  if (painted > 0) {
    syncGraphqlCartTotalsFromLineRows(cart, items);
  }
}

/**
 * Subtotal = sum of line rows; grand totals shift by the same delta as subtotal.
 *
 * @param {Record<string, any>} cart
 * @param {Array<Record<string, any>>} items
 */
export function syncGraphqlCartTotalsFromLineRows(cart, items) {
  if (!cart.prices || typeof cart.prices !== 'object' || !Array.isArray(items)) {
    return;
  }

  let sumEx = 0;
  let sumInc = 0;
  let currency = cart.prices.subtotal_excluding_tax?.currency
    || cart.prices.subtotal_including_tax?.currency
    || cart.prices.grand_total?.currency
    || 'USD';

  items.forEach((item) => {
    const ex = Number(item?.prices?.row_total?.value);
    const inc = Number(
      item?.prices?.row_total_including_tax?.value
      ?? item?.prices?.row_total?.value,
    );
    if (Number.isFinite(ex)) sumEx += ex;
    if (Number.isFinite(inc)) sumInc += inc;
    currency = item?.prices?.row_total?.currency || currency;
  });

  const money = (amount) => ({ value: roundMoney(amount), currency });
  const { prices } = cart;

  const prevEx = Number(prices.subtotal_excluding_tax?.value);
  if (Number.isFinite(sumEx)) {
    const deltaEx = Number.isFinite(prevEx) ? sumEx - prevEx : 0;
    prices.subtotal_excluding_tax = money(sumEx);
    shiftMoneyField(prices, 'subtotal_with_discount_excluding_tax', deltaEx, money(sumEx));
    shiftMoneyField(prices, 'grand_total_excluding_tax', deltaEx, null);
  }

  const prevInc = Number(prices.subtotal_including_tax?.value);
  if (Number.isFinite(sumInc)) {
    const deltaInc = Number.isFinite(prevInc) ? sumInc - prevInc : 0;
    prices.subtotal_including_tax = money(sumInc);
    shiftMoneyField(prices, 'grand_total', deltaInc, null);
  }
}

/**
 * Strip the merge option from RecurBuy lines only: lines carrying our quote
 * marker, or painted by the optimistic path (their option id comes from that
 * entry because the add response carries no marker yet).
 *
 * @param {unknown} cart
 * @param {OptimisticLine[]} [optimisticLines]
 */
export function stripMergeOptionsOnGraphqlCart(cart, optimisticLines = []) {
  cartLines(cart).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const optimistic = typeof item.uid === 'string' && item.uid
      ? optimisticLines.find((entry) => entry?.uid === item.uid)
      : null;
    const markerId = lineOptionId(item);
    if (!markerId && !optimistic) return;
    stripCartLineCustomizableOptionsOnGraphqlItem(item, markerId || optimistic?.optionId);
  });
}

/**
 * Walk {@code response.data} for GraphQL cart objects. Once a cart is found,
 * do not recurse into it — {@code itemsV2} itself has an {@code items} array
 * and would otherwise be treated as a second cart.
 *
 * @param {unknown} node
 * @param {number} depth
 * @returns {Array<Record<string, any>>}
 */
function collectGraphqlCarts(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return [];

  const isGraphqlCart = Array.isArray(node.itemsV2?.items);
  // Bare {@code items} only when it looks like a cart root (not itemsV2).
  const isItemsCart = !isGraphqlCart
    && Array.isArray(node.items)
    && (node.prices != null || node.id != null);

  if (isGraphqlCart || isItemsCart) {
    return /** @type {Array<Record<string, any>>} */ ([node]);
  }

  return Object.values(node).flatMap((value) => (
    value && typeof value === 'object' ? collectGraphqlCarts(value, depth + 1) : []
  ));
}

/**
 * @param {Record<string, any>} item
 * @param {{ planUnit: PlanUnit, optionId?: string|number|null }} stamp
 */
function stampOptimisticMarkersOnGraphqlItem(item, stamp) {
  if (!Array.isArray(item.custom_attributes)) {
    item.custom_attributes = [];
  }

  const attrs = item.custom_attributes;
  upsertGraphqlAttribute(
    attrs,
    RECURBUY_PLAN_UNIT,
    `${stamp.planUnit.value}|${stamp.planUnit.currency}`,
  );

  const optionId = stamp.optionId != null ? String(stamp.optionId).trim() : '';
  if (optionId && optionId !== '0') {
    upsertGraphqlAttribute(attrs, RECURBUY_SUBSCRIPTION_OPTION_ID, optionId);
  }
}

/**
 * @param {Array<{ attribute_code?: string, value?: string }>} attrs
 * @param {string} code
 * @param {string} value
 */
function upsertGraphqlAttribute(attrs, code, value) {
  const existing = attrs.find((entry) => entry?.attribute_code === code);
  if (existing) {
    existing.value = value;
    return;
  }
  attrs.push({ attribute_code: code, value });
}

/**
 * @param {Record<string, any>} item a RecurBuy line
 * @param {string|number|null|undefined} optionId the line's own subscription option id
 */
function stripCartLineCustomizableOptionsOnGraphqlItem(item, optionId) {
  const options = item.customizable_options;
  if (!Array.isArray(options) || !options.length) return;

  const id = optionId != null ? String(optionId).trim() : '';
  const kept = options.filter((option) => !isCartLineOptionConfiguration(option, id));
  // Keep the received array when nothing is ours.
  if (kept.length !== options.length) item.customizable_options = kept;
}

/**
 * @param {Record<string, any>} item
 * @param {{ value: number, currency: string }} money
 */
function patchConfigurableVariantRegular(item, money) {
  if (item.__typename !== 'ConfigurableCartItem') return;
  const max = item.configured_variant?.price_range?.maximum_price;
  if (!max || typeof max !== 'object') return;
  if (max.regular_price && typeof max.regular_price === 'object') {
    max.regular_price = { ...money };
  }
  if (max.final_price && typeof max.final_price === 'object') {
    max.final_price = { ...money };
  }
}

/**
 * @param {Record<string, any>} prices
 * @param {string} field
 * @param {number} delta
 * @param {{ value: number, currency: string }|null} fallback
 */
function shiftMoneyField(prices, field, delta, fallback) {
  const current = Number(prices[field]?.value);
  if (Number.isFinite(current) && Number.isFinite(delta) && delta !== 0) {
    const currency = prices[field]?.currency || fallback?.currency || 'USD';
    prices[field] = { value: roundMoney(current + delta), currency };
    return;
  }
  if (fallback && prices[field] == null) {
    prices[field] = fallback;
  }
}

/**
 * @param {number} amount
 * @returns {number}
 */
function roundMoney(amount) {
  return Math.round(amount * 100) / 100;
}
