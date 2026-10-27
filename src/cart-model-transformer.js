/**
 * Pure CartModel transformer patch (no drop-in imports).
 *
 * Adobe calls {@code models.CartModel.transformer(rawGraphqlCart)} and
 * deep-merges the result into the mapped CartModel (arrays by index). Keys can
 * be added or overridden but not removed — AccS merge-option hide therefore
 * happens in the GraphQL raw normaliser before mapping.
 *
 * This module returns a CartModel-shaped patch: per-item {@code recurbuy} bag
 * from quote {@code custom_attributes}, aligned {@code regularPrice}/
 * {@code total} for subscription lines, and {@code miniCartMaxItems} sliced to
 * the drop-in display max (never longer than that slice).
 *
 * Add-on contract: only RecurBuy lines are patched. A cart without any
 * RecurBuy line gets no patch at all ({@code null}); in a mixed cart the
 * host's lines get an empty {@code {}} patch.
 */

import {
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_LABEL,
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
} from './contract.js';
import { cartLines } from './cart-lines.js';
import { parseQuoteBillingPeriod } from './format.js';
import {
  attributeValue,
  isRecurbuyLine,
  parsePlanUnit,
  readItemAttributes,
} from './recurbuy-line.js';

/** Adobe cart drop-in default when {@code miniCartMaxItemsDisplay} is unset. */
export const DEFAULT_MINI_CART_MAX_ITEMS = 10;

/**
 * @typedef {import('./recurbuy-line.js').CartLineAttribute} CartLineAttribute
 * @typedef {{
 *   optionId: string|null,
 *   catalogProductId: string,
 *   startDate: string|null,
 *   planLabel: string|null,
 *   period: import('./contract.js').SubscriptionPeriod|null,
 *   endsLabel: string|null,
 *   planUnit: { value: number, currency: string }|null,
 *   attributes: CartLineAttribute[],
 * }} RecurbuyLineBag
 */

/**
 * Build a CartModel deep-merge patch from the raw GraphQL cart Adobe passes
 * into {@code CartModel.transformer}.
 *
 * Also accepts an already-mapped CartModel ({@code items}) for unit tests.
 *
 * @param {Record<string, any>|null|undefined} cart
 * @param {{ miniCartMaxItemsDisplay?: number }} [options]
 *   Display max from cart drop-in config (not guessed from the raw cart).
 * @returns {{
 *   items: Array<Record<string, any>>,
 *   miniCartMaxItems: Array<Record<string, any>>,
 * }|null}
 */
export function transformCartModel(cart, options = {}) {
  const rawItems = cartLines(cart);
  if (!rawItems.some(isRecurbuyLine)) return null;

  const items = rawItems.map((raw) => (isRecurbuyLine(raw) ? transformRawCartItem(raw) : {}));
  const max = resolveMiniCartMax(options.miniCartMaxItemsDisplay);

  return {
    items,
    // Same per-index patches as items; never longer than the drop-in slice
    // (deep-merge can ADD indices if we return a longer array).
    miniCartMaxItems: items.slice(0, max),
  };
}

/**
 * @param {Record<string, any>|null|undefined} raw
 * @returns {Record<string, any>}
 */
function transformRawCartItem(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const recurbuy = buildRecurbuyBag(raw);
  /** @type {Record<string, any>} */
  const patch = { recurbuy };

  const aligned = alignPlanUnitDisplayFields(raw, recurbuy);
  if (aligned.regularPrice) patch.regularPrice = aligned.regularPrice;
  if (aligned.total) patch.total = aligned.total;
  if (aligned.price) patch.price = aligned.price;
  if (aligned.rowTotal) patch.rowTotal = aligned.rowTotal;

  return patch;
}

/**
 * @param {Record<string, any>|null|undefined} item
 * @returns {RecurbuyLineBag}
 */
export function buildRecurbuyBag(item) {
  const attributes = readItemAttributes(item);
  const optionId = attributeValue(attributes, RECURBUY_SUBSCRIPTION_OPTION_ID);
  const planUnit = parsePlanUnit(attributeValue(attributes, RECURBUY_PLAN_UNIT));
  const startDate = attributeValue(attributes, RECURBUY_SUBSCRIPTION_START_DATE) || null;
  const planLabel = attributeValue(attributes, RECURBUY_PLAN_LABEL) || null;
  const endsLabel = attributeValue(attributes, RECURBUY_ENDS_LABEL) || null;
  const periodRaw = attributeValue(attributes, RECURBUY_BILLING_PERIOD);
  const period = periodRaw ? parseQuoteBillingPeriod(periodRaw) : null;
  const catalogProductId = resolveCatalogProductId(item)
    || (typeof item?.recurbuy?.catalogProductId === 'string'
      ? item.recurbuy.catalogProductId
      : '');

  return {
    optionId: optionId && optionId !== '0' ? optionId : null,
    catalogProductId,
    startDate,
    planLabel,
    period,
    endsLabel,
    planUnit,
    attributes,
  };
}

/**
 * Commerce product uid is the base64 catalog id (`OTg=` → `98`).
 * Prefer the configured variant (child that owns the option).
 *
 * @param {Record<string, any>|null|undefined} item
 * @returns {string}
 */
export function resolveCatalogProductId(item) {
  if (!item || typeof item !== 'object') return '';
  const configured = item.configured_variant || item.configuredVariant || {};
  const product = item.product || {};
  return decodeCatalogId(configured.uid) || decodeCatalogId(product.uid);
}

/**
 * @param {string|undefined} uid
 * @returns {string}
 */
function decodeCatalogId(uid) {
  if (typeof uid !== 'string' || uid.trim() === '') return '';
  try {
    const decoded = atob(uid).trim();
    return /^\d+$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function resolveMiniCartMax(value) {
  const max = Number(value);
  if (Number.isFinite(max) && max > 0) {
    return Math.floor(max);
  }
  return DEFAULT_MINI_CART_MAX_ITEMS;
}

/**
 * Align Adobe MiniCart EXCLUDING_TAX paint fields ({@code regularPrice}/
 * {@code total}) to the plan unit already on the GraphQL line (or CartModel).
 *
 * @param {Record<string, any>} item
 * @param {RecurbuyLineBag} recurbuy
 * @returns {{
 *   regularPrice?: { value: number, currency: string },
 *   total?: { value: number, currency: string },
 *   price?: { value: number, currency: string },
 *   rowTotal?: { value: number, currency: string },
 * }}
 */
function alignPlanUnitDisplayFields(item, recurbuy) {
  const optimistic = recurbuy.planUnit;
  const isSubscription = Boolean(recurbuy.optionId || optimistic);
  if (!isSubscription) return {};

  const fromModelPrice = Number(item.price?.value);
  const fromGraphqlPrice = Number(item.prices?.price?.value);
  const fallbackUnit = optimistic ? Number(optimistic.value) : NaN;
  let unit = NaN;
  if (Number.isFinite(fromModelPrice) && fromModelPrice >= 0) {
    unit = fromModelPrice;
  } else if (Number.isFinite(fromGraphqlPrice) && fromGraphqlPrice >= 0) {
    unit = fromGraphqlPrice;
  } else {
    unit = fallbackUnit;
  }
  if (!Number.isFinite(unit) || unit < 0) return {};

  const currency = item.price?.currency
    || item.prices?.price?.currency
    || optimistic?.currency
    || item.rowTotal?.currency
    || item.prices?.row_total?.currency
    || item.regularPrice?.currency
    || 'USD';
  const planMoney = { value: unit, currency };
  const qty = Number(item.quantity);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;

  const rowFromModel = item.rowTotal && Number.isFinite(Number(item.rowTotal.value))
    ? { value: Number(item.rowTotal.value), currency: item.rowTotal.currency || currency }
    : null;
  const rowFromGraphql = item.prices?.row_total
    && Number.isFinite(Number(item.prices.row_total.value))
    ? {
      value: Number(item.prices.row_total.value),
      currency: item.prices.row_total.currency || currency,
    }
    : null;
  const rowMoney = rowFromModel || rowFromGraphql || { value: unit * quantity, currency };

  const regular = Number(
    item.regularPrice?.value
    ?? item.prices?.original_item_price?.value,
  );
  const total = Number(
    item.total?.value
    ?? item.prices?.original_row_total?.value,
  );
  const row = Number(rowMoney.value);
  const unitNeedsAlign = !Number.isFinite(regular) || regular > unit * 1.01
    || (optimistic && Math.abs(regular - unit) > 0.001);
  const totalNeedsAlign = !Number.isFinite(total)
    || (Number.isFinite(row) && total > row * 1.01)
    || (optimistic && Number.isFinite(total) && Math.abs(total - row) > 0.001);

  /** @type {ReturnType<typeof alignPlanUnitDisplayFields>} */
  const patch = {};
  if (unitNeedsAlign) patch.regularPrice = planMoney;
  if (totalNeedsAlign) patch.total = rowMoney;
  if (!item.price || item.price.value !== unit) patch.price = planMoney;
  if (!item.rowTotal) patch.rowTotal = rowMoney;
  return patch;
}

/**
 * Deep-merge prior + RecurBuy patches. {@code items} / {@code miniCartMaxItems}
 * merge by index so a prior transformer’s per-item fields are not wiped.
 *
 * Without a RecurBuy patch ({@code null}: no RecurBuy line in the cart) the
 * prior result is returned untouched — same reference, same value.
 *
 * @param {Record<string, any>|null|undefined} base
 * @param {Record<string, any>|null|undefined} patched
 * @returns {Record<string, any>|null|undefined}
 */
export function composeCartModelPatches(base, patched) {
  const right = patched && typeof patched === 'object' ? patched : null;
  if (!right) return base;
  const left = base && typeof base === 'object' ? base : null;
  if (!left) return { ...right };

  /** @type {Record<string, any>} */
  const merged = { ...left, ...right };

  if (Array.isArray(left.items) || Array.isArray(right.items)) {
    merged.items = mergeItemPatchesByIndex(left.items, right.items);
  }

  if (Array.isArray(left.miniCartMaxItems) || Array.isArray(right.miniCartMaxItems)) {
    // Prefer RecurBuy slice length — never grow past the drop-in max.
    const length = Array.isArray(right.miniCartMaxItems)
      ? right.miniCartMaxItems.length
      : left.miniCartMaxItems.length;
    merged.miniCartMaxItems = mergeItemPatchesByIndex(
      left.miniCartMaxItems,
      right.miniCartMaxItems,
      length,
    );
  }

  return merged;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @param {number} [fixedLength]
 * @returns {Array<Record<string, any>>}
 */
function mergeItemPatchesByIndex(left, right, fixedLength) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  const len = Number.isFinite(fixedLength)
    ? /** @type {number} */ (fixedLength)
    : Math.max(a.length, b.length);

  return Array.from({ length: len }, (_, index) => {
    const fromLeft = a[index] && typeof a[index] === 'object' ? a[index] : {};
    const fromRight = b[index] && typeof b[index] === 'object' ? b[index] : {};
    return { ...fromLeft, ...fromRight };
  });
}
