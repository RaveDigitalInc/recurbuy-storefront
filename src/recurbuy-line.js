/**
 * Pure "is this line ours" identity for cart lines. No drop-in imports.
 *
 * A line is a RecurBuy line only when it carries a RecurBuy quote marker
 * (option id or optimistic plan unit). Everything else in the cart — lines,
 * attributes, options — belongs to the host and must never be touched.
 *
 * Accepts the raw GraphQL line ({@code custom_attributes}) and the mapped
 * CartModel line ({@code recurbuy} bag stamped by the transformer).
 */

import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_QUOTE_ATTRIBUTE_CODES,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from './contract.js';
import { cartLines, findLineByUid } from './cart-lines.js';

const OWN_ATTRIBUTE_CODES = new Set(RECURBUY_QUOTE_ATTRIBUTE_CODES);

/**
 * @typedef {{ code: string, value: string }} CartLineAttribute
 */

/**
 * RecurBuy quote attributes of a line, other modules' attributes excluded.
 *
 * @param {Record<string, any>|null|undefined} item
 * @returns {CartLineAttribute[]}
 */
export function readItemAttributes(item) {
  if (Array.isArray(item?.recurbuy?.attributes) && item.recurbuy.attributes.length) {
    return item.recurbuy.attributes
      .map((entry) => ({ code: entry.code, value: entry.value }))
      .filter(({ code }) => OWN_ATTRIBUTE_CODES.has(code));
  }

  const raw = item?.custom_attributes || item?.customAttributes;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => ({
      code: String(entry?.attribute_code ?? entry?.code ?? '').trim(),
      value: entry?.value != null ? String(entry.value).trim() : '',
    }))
    .filter(({ code, value }) => OWN_ATTRIBUTE_CODES.has(code) && value);
}

/**
 * @param {CartLineAttribute[]} attributes
 * @param {string} code
 * @returns {string}
 */
export function attributeValue(attributes, code) {
  const found = attributes.find((entry) => entry.code === code);
  return found ? found.value : '';
}

/**
 * @param {string} raw {@code value|currency}
 * @returns {{ value: number, currency: string }|null}
 */
export function parsePlanUnit(raw) {
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
 * The line's own subscription option id marker ({@code ''} when it has none).
 *
 * @param {Record<string, any>|null|undefined} item
 * @returns {string}
 */
export function lineOptionId(item) {
  const fromBag = item?.recurbuy?.optionId;
  const id = fromBag != null && fromBag !== ''
    ? String(fromBag).trim()
    : attributeValue(readItemAttributes(item), RECURBUY_SUBSCRIPTION_OPTION_ID);
  return id && id !== '0' ? id : '';
}

/**
 * @param {Record<string, any>|null|undefined} item
 * @returns {boolean}
 */
export function isRecurbuyLine(item) {
  if (!item || typeof item !== 'object') return false;
  if (lineOptionId(item)) return true;
  if (item.recurbuy?.planUnit && typeof item.recurbuy.planUnit === 'object') return true;
  return parsePlanUnit(attributeValue(readItemAttributes(item), RECURBUY_PLAN_UNIT)) !== null;
}

/**
 * @param {Record<string, any>|Array<Record<string, any>>|null|undefined} cartOrItems
 *   a GraphQL cart, a CartModel, or the lines themselves
 * @returns {boolean}
 */
export function hasRecurbuyLines(cartOrItems) {
  const items = Array.isArray(cartOrItems) ? cartOrItems : cartLines(cartOrItems);
  return items.some(isRecurbuyLine);
}

/**
 * @param {Array<Record<string, any>>|null|undefined} items
 * @returns {Set<string>} uids of RecurBuy lines
 */
export function recurbuyLineUids(items) {
  const uids = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (typeof item?.uid === 'string' && item.uid && isRecurbuyLine(item)) uids.add(item.uid);
  });
  return uids;
}

/**
 * Subscription finalize may stamp a brand-new uid, or a line that is already
 * RecurBuy (qty add onto the same option). A host line that was already in the
 * cart must never receive our quote attributes.
 *
 * The pre-add cache often has no quote markers, so an existing subscription
 * line is recognised from the add response ({@code afterCart}) as well.
 *
 * @param {Object|null|undefined} beforeCart
 * @param {string|null|undefined} targetUid
 * @param {Object|null|undefined} [afterCart]
 * @returns {boolean}
 */
export function isSafeSubscriptionStampTarget(beforeCart, targetUid, afterCart) {
  if (typeof targetUid !== 'string' || !targetUid) return false;
  const prior = findLineByUid(beforeCart, targetUid);
  if (!prior) return true;
  return isRecurbuyLine(prior) || isRecurbuyLine(findLineByUid(afterCart, targetUid));
}
