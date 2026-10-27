/**
 * Cart-line RecurBuy readers. Prefer {@code item.recurbuy} stamped by the
 * CartModel transformer; fall back to {@code custom_attributes} still present
 * on the model item.
 */

import {
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
} from './contract.js';
import { readItemAttributes } from './recurbuy-line.js';

/**
 * @param {{ uid?: string, recurbuy?: Record<string, any> }|null|undefined} item
 * @param {string} code
 * @returns {string|null}
 */
function lineAttributeValue(item, code) {
  if (item?.recurbuy && typeof item.recurbuy === 'object') {
    if (code === RECURBUY_SUBSCRIPTION_OPTION_ID) {
      return item.recurbuy.optionId || null;
    }
    if (code === RECURBUY_SUBSCRIPTION_START_DATE) {
      return item.recurbuy.startDate || null;
    }
    const fromBag = (item.recurbuy.attributes || []).find((entry) => entry.code === code);
    if (fromBag) return fromBag.value;
  }

  const found = readItemAttributes(item).find((entry) => entry.code === code);
  return found ? found.value : null;
}

/**
 * @param {{ uid?: string, recurbuy?: { optionId?: string|null } }|null|undefined} item
 * @returns {string|null}
 */
export function getSubscriptionOptionIdFromCartItem(item) {
  if (item?.recurbuy?.optionId) return item.recurbuy.optionId;
  return lineAttributeValue(item, RECURBUY_SUBSCRIPTION_OPTION_ID);
}

/**
 * @param {{ uid?: string, recurbuy?: { startDate?: string|null } }|null|undefined} item
 * @returns {string|null}
 */
export function getSubscriptionStartDateFromCartItem(item) {
  if (item?.recurbuy?.startDate) return item.recurbuy.startDate;
  return lineAttributeValue(item, RECURBUY_SUBSCRIPTION_START_DATE);
}
