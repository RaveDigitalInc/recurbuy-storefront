/**
 * Pure peek of quote subscription markers from CartModel / raw attrs.
 * No drop-in imports — safe for Node unit tests.
 */

import {
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_LABEL,
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
} from '../contract.js';
import { parseQuoteBillingPeriod } from '../format.js';

/**
 * @typedef {{
 *   optionId: string,
 *   catalogProductId: string,
 *   unitPrice: number|null,
 *   currency: string,
 *   startDate: string,
 *   planLabel: string,
 *   period: import('../contract.js').SubscriptionPeriod|null,
 *   endsLabel: string,
 *   stampedPlanUnit: { value: number, currency: string }|null,
 * }} QuoteSubscriptionMarker
 */

/**
 * Markers already on CartModel items ({@code item.recurbuy} from the
 * transformer, or raw {@code custom_attributes}). Skips a second cart
 * round-trip when that payload is current and complete.
 *
 * Returns {@code null} when a subscription line is missing
 * {@code catalogProductId} so the caller can {@code loadQuoteSubscriptionMarkers}.
 *
 * @param {Array<{
 *   uid?: string,
 *   recurbuy?: Record<string, any>,
 *   custom_attributes?: Array<{ attribute_code?: string, value?: string }>,
 *   customAttributes?: Array<{ attribute_code?: string, value?: string }>,
 *   price?: { value?: number, currency?: string },
 * }>|null|undefined} items
 * @returns {Map<string, QuoteSubscriptionMarker>|null}
 */
export function peekCapturedQuoteMarkers(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return new Map();

  const uids = list
    .map((item) => item?.uid)
    .filter((uid) => typeof uid === 'string' && uid);
  if (!uids.length) return new Map();

  // The transformer stamps {@code recurbuy} on RecurBuy lines only; host lines
  // of a mixed cart carry none and simply yield no marker.
  const anyHasRecurbuy = list.some(
    (item) => item && Object.prototype.hasOwnProperty.call(item, 'recurbuy'),
  );
  if (anyHasRecurbuy) {
    const markers = markersFromRecurbuyItems(list);
    // Legacy carts / stock fragment without product.uid leave simples empty.
    if (subscriptionMarkersNeedCatalogBackfill(list, markers)) {
      return null;
    }
    return markers;
  }

  // Raw attrs still on the model (before / without transformer).
  const allHaveAttrs = list.every((item) => (
    Array.isArray(item?.custom_attributes)
    || Array.isArray(item?.customAttributes)
  ));
  if (allHaveAttrs) {
    const markers = markersFromAttributeItems(list);
    if (subscriptionMarkersNeedCatalogBackfill(list, markers)) {
      return null;
    }
    return markers;
  }

  return null;
}

/**
 * True when any subscription line still lacks a catalog product id (needed for
 * plan-label backfill via subscription-config cache).
 *
 * @param {Array<Record<string, any>>|null|undefined} items
 * @param {Map<string, QuoteSubscriptionMarker>|null|undefined} markers
 * @returns {boolean}
 */
export function subscriptionMarkersNeedCatalogBackfill(items, markers) {
  const list = Array.isArray(items) ? items : [];
  return list.some((item) => {
    const optionId = item?.recurbuy?.optionId
      || markers?.get(item?.uid)?.optionId;
    if (!optionId || optionId === '0') return false;
    const uid = typeof item?.uid === 'string' ? item.uid : '';
    if (!uid) return false;
    const catalogId = markers?.get(uid)?.catalogProductId
      || (typeof item?.recurbuy?.catalogProductId === 'string'
        ? item.recurbuy.catalogProductId
        : '');
    return !catalogId;
  });
}

/**
 * @param {Array<Record<string, any>>} items
 * @returns {Map<string, QuoteSubscriptionMarker>}
 */
function markersFromRecurbuyItems(items) {
  const markers = new Map();
  items.forEach((item) => {
    const uid = typeof item?.uid === 'string' ? item.uid : '';
    const bag = item?.recurbuy;
    const optionId = bag?.optionId;
    if (!uid || !optionId || optionId === '0') return;

    const stampedPlanUnit = bag.planUnit && typeof bag.planUnit.value === 'number'
      ? { value: bag.planUnit.value, currency: bag.planUnit.currency || 'USD' }
      : null;
    const unitPrice = Number(item?.price?.value);
    markers.set(uid, {
      optionId: String(optionId),
      catalogProductId: typeof bag.catalogProductId === 'string'
        ? bag.catalogProductId
        : '',
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
      currency: typeof item?.price?.currency === 'string'
        ? item.price.currency
        : (stampedPlanUnit?.currency || 'USD'),
      startDate: typeof bag.startDate === 'string' ? bag.startDate : '',
      planLabel: typeof bag.planLabel === 'string' ? bag.planLabel : '',
      period: bag.period || null,
      endsLabel: typeof bag.endsLabel === 'string' ? bag.endsLabel : '',
      stampedPlanUnit,
    });
  });
  return markers;
}

/**
 * @param {Array<Record<string, any>>} items
 * @returns {Map<string, QuoteSubscriptionMarker>}
 */
function markersFromAttributeItems(items) {
  const markers = new Map();
  items.forEach((item) => {
    const marker = markerFromGraphqlItem({
      ...item,
      custom_attributes: item.custom_attributes || item.customAttributes,
      prices: item.prices || (item.price ? { price: item.price } : undefined),
    });
    if (marker && item.uid) markers.set(item.uid, marker);
  });
  return markers;
}

/**
 * @param {Record<string, any>} item
 * @returns {QuoteSubscriptionMarker|null}
 */
function markerFromGraphqlItem(item) {
  const uid = typeof item?.uid === 'string' ? item.uid : '';
  const attrs = item?.custom_attributes;
  const optionId = attributeValue(attrs, RECURBUY_SUBSCRIPTION_OPTION_ID);
  if (!uid || !optionId || optionId === '0') return null;

  const unitPrice = Number(item?.prices?.price?.value);
  const stampedPlanUnit = parsePlanUnit(attributeValue(attrs, RECURBUY_PLAN_UNIT));
  return {
    optionId,
    catalogProductId: resolveCatalogProductId(item),
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    currency: typeof item?.prices?.price?.currency === 'string'
      ? item.prices.price.currency
      : 'USD',
    startDate: attributeValue(attrs, RECURBUY_SUBSCRIPTION_START_DATE),
    planLabel: attributeValue(attrs, RECURBUY_PLAN_LABEL),
    period: parseQuoteBillingPeriod(attributeValue(attrs, RECURBUY_BILLING_PERIOD)),
    endsLabel: attributeValue(attrs, RECURBUY_ENDS_LABEL),
    stampedPlanUnit,
  };
}

/**
 * @param {string} raw
 * @returns {{ value: number, currency: string }|null}
 */
function parsePlanUnit(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const [valuePart, currencyPart] = raw.trim().split('|');
  const value = Number(valuePart);
  if (!Number.isFinite(value) || value < 0) return null;
  const currency = typeof currencyPart === 'string' && currencyPart.trim()
    ? currencyPart.trim()
    : 'USD';
  return { value, currency };
}

/**
 * @param {Array<{ attribute_code?: string, value?: string }>|null|undefined} attributes
 * @param {string} code
 * @returns {string}
 */
function attributeValue(attributes, code) {
  if (!Array.isArray(attributes)) return '';
  const match = attributes.find((attribute) => attribute?.attribute_code === code);
  return typeof match?.value === 'string' ? match.value.trim() : '';
}

/**
 * @param {{ product?: { uid?: string }, configured_variant?: { uid?: string } }} item
 * @returns {string}
 */
function resolveCatalogProductId(item) {
  return decodeCatalogId(item?.configured_variant?.uid)
    || decodeCatalogId(item?.configuredVariant?.uid)
    || decodeCatalogId(item?.product?.uid);
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
