import {
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_LABEL,
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
} from './contract.js';

/** Internal quote markers — not shown in the product attributes slot. */
const HIDDEN_CART_LINE_ATTRIBUTE_CODES = new Set([
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
  RECURBUY_PLAN_LABEL,
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_UNIT,
]);

/**
 * @typedef {{ code: string, value: string }} CartLineAttribute
 */

/** @type {Map<string, CartLineAttribute[]>} */
const attributesByUid = new Map();

/**
 * @param {unknown} node
 * @param {number} depth
 * @returns {Array<Record<string, any>>}
 */
function collectCartLines(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 3) return [];
  const lines = node.itemsV2?.items;
  if (Array.isArray(lines)) return lines;
  return Object.values(node).flatMap((value) => collectCartLines(value, depth + 1));
}

/**
 * Keeps the RecurBuy quote markers of every cart line seen in a Commerce
 * GraphQL response. The cart drop-in drops `custom_attributes` while mapping,
 * so this runs from the FetchGraphQL after-hook, before the drop-in reads it.
 *
 * @param {unknown} data GraphQL `response.data`
 */
export function captureCartLineAttributes(data) {
  collectCartLines(data).forEach((line) => {
    if (!line?.uid || !Array.isArray(line.custom_attributes)) return;
    const attributes = line.custom_attributes
      .map((entry) => ({
        code: entry?.attribute_code?.trim(),
        value: entry?.value != null ? String(entry.value).trim() : '',
      }))
      .filter(({ code, value }) => code && value);
    if (attributes.length) attributesByUid.set(line.uid, attributes);
    else attributesByUid.delete(line.uid);
  });
}

/**
 * @param {{ uid?: string }|null|undefined} item
 * @param {string} code
 * @returns {string|null}
 */
function lineAttributeValue(item, code) {
  const found = (attributesByUid.get(item?.uid) || []).find((entry) => entry.code === code);
  return found ? found.value : null;
}

/**
 * Matches the cart drop-in's product attribute labels (`color_family` → `Color Family`).
 *
 * @param {string} code
 * @returns {string}
 */
export function formatCartAttributeLabel(code) {
  return String(code)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * @param {{ uid?: string }|null|undefined} item
 * @returns {CartLineAttribute[]}
 */
export function getVisibleCartLineAttributes(item) {
  return (attributesByUid.get(item?.uid) || [])
    .filter(({ code }) => !HIDDEN_CART_LINE_ATTRIBUTE_CODES.has(code));
}

/**
 * @param {{ uid?: string }|null|undefined} item
 * @returns {string|null}
 */
export function getSubscriptionOptionIdFromCartItem(item) {
  return lineAttributeValue(item, RECURBUY_SUBSCRIPTION_OPTION_ID);
}

/**
 * @param {{ uid?: string }|null|undefined} item
 * @returns {string|null}
 */
export function getSubscriptionStartDateFromCartItem(item) {
  return lineAttributeValue(item, RECURBUY_SUBSCRIPTION_START_DATE);
}
