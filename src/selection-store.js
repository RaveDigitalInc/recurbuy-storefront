/**
 * In-memory optimistic selection cache for the current document only.
 * Quote `custom_attributes` are the source of truth for cart / mini-cart;
 * this map covers the brief gap between add and the GraphQL quote read.
 * Nothing is written to sessionStorage / localStorage.
 */

const LEGACY_SESSION_KEY = 'recurbuy.subscription.selections';

/**
 * @typedef {import('./contract.js').SubscriptionSelection & {
 *   planSnapshot?: {
 *     planLabel?: string,
 *     period?: import('./contract.js').SubscriptionPeriod,
 *     price?: import('./contract.js').MoneyAmount,
 *     startDate?: string,
 *     endsLabel?: string,
 *   }
 * }} SubscriptionSelection
 */

/**
 * @type {{
 *   bySku: Record<string, SubscriptionSelection>,
 *   byUid: Record<string, SubscriptionSelection>,
 * }}
 */
const store = { bySku: {}, byUid: {} };

purgeLegacySessionStorage();

/**
 * Drop the old sessionStorage blob so prior tabs do not keep a second SoR.
 */
function purgeLegacySessionStorage() {
  try {
    window.sessionStorage?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // private mode / blocked storage
  }
}

/**
 * @param {string|undefined|null} sku
 * @param {SubscriptionSelection|null|undefined} selection
 */
export function saveSelectionForSku(sku, selection) {
  persistSelection('bySku', sku, selection);
}

/**
 * @param {string|undefined|null} uid
 * @param {SubscriptionSelection|null|undefined} selection
 */
export function saveSelectionForUid(uid, selection) {
  persistSelection('byUid', uid, selection);
}

/**
 * @param {'bySku'|'byUid'} bucket
 * @param {string|undefined|null} key
 * @param {SubscriptionSelection|null|undefined} selection
 */
function persistSelection(bucket, key, selection) {
  if (!key) return;

  if (!selection || selection.purchaseType !== 'subscription' || !selection.planId) {
    delete store[bucket][key];
    return;
  }

  store[bucket][key] = {
    purchaseType: 'subscription',
    planId: selection.planId,
    customOptionValues: { ...(selection.customOptionValues || {}) },
    ...(selection.planSnapshot && { planSnapshot: { ...selection.planSnapshot } }),
  };
}

/**
 * @param {{
 *   uid?: string,
 *   sku?: string,
 *   topLevelSku?: string,
 * }|null|undefined} item
 * @returns {SubscriptionSelection|null}
 */
export function getSelectionForCartItem(item) {
  if (!item) return null;

  // Cart lines always have a uid. Never fall back to bySku — that snapshot is
  // from the last plan add of this SKU and would paint a later one-time line
  // (or another uid of the same SKU) as a subscription.
  if (item.uid) {
    return store.byUid[item.uid] || null;
  }

  if (item.sku && store.bySku[item.sku]) {
    return store.bySku[item.sku];
  }

  // Configurable children share one parent SKU. That snapshot is whichever
  // variant was added last, so it must not paint the other lines.
  if (
    item.topLevelSku
    && (!item.sku || item.sku === item.topLevelSku)
    && store.bySku[item.topLevelSku]
  ) {
    return store.bySku[item.topLevelSku];
  }

  return null;
}

/**
 * Drop selections for cart item UIDs that are no longer in the cart.
 * @param {Array<{ uid?: string }>|null|undefined} items
 */
export function pruneSelectionsToCartItems(items) {
  const liveUids = new Set((items || []).map((item) => item?.uid).filter(Boolean));

  Object.keys(store.byUid).forEach((uid) => {
    if (!liveUids.has(uid)) {
      delete store.byUid[uid];
    }
  });
}
