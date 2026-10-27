/**
 * Pure decisions behind the cart UI runtime: which cart / which rows are ours.
 * No DOM, no drop-in imports — runs in Node tests.
 *
 * Add-on contract: a cart without RecurBuy lines is out of scope (the runtime
 * only removes what it painted earlier); inside a RecurBuy cart only rows whose
 * uid maps to a RecurBuy line are painted.
 */

import { cartLines } from './cart-lines.js';
import { recurbuyLineUids } from './recurbuy-line.js';

const ROW_UID_RE = /^cart-list-item-entry-(.+)$/;

/**
 * @typedef {{ active: boolean, ownedUids: Set<string> }} CartPaintScope
 */

/**
 * @param {Array<Record<string, any>>|Record<string, any>|null|undefined} cartOrItems
 * @returns {CartPaintScope}
 */
export function resolveCartPaintScope(cartOrItems) {
  const items = Array.isArray(cartOrItems) ? cartOrItems : cartLines(cartOrItems);
  const ownedUids = recurbuyLineUids(items);
  return { active: ownedUids.size > 0, ownedUids };
}

/**
 * @param {string|null|undefined} testId `data-testid` of a cart-drop-in row
 * @returns {string} line uid, or '' when the row is not a cart line entry
 */
export function rowUidFromTestId(testId) {
  return ROW_UID_RE.exec(testId || '')?.[1] || '';
}

/**
 * @param {CartPaintScope} scope
 * @param {string} rowUid
 * @param {{ purchaseType?: string }|null|undefined} details
 * @returns {'paint'|'clear'}
 *   `clear` = leave the row alone except for removing our own host from it
 */
export function planRowPaint(scope, rowUid, details) {
  if (!scope.active || !rowUid || !scope.ownedUids.has(rowUid)) return 'clear';
  return details?.purchaseType === 'subscription' ? 'paint' : 'clear';
}
