/**
 * Shopper Account subscription routes (EDS).
 * Parity with Magento SARP customer pages under aw_sarp2/profile* (module-sarp3).
 *
 * Default (no DA write needed): single published document + hash
 *   /customer/subscriptions
 *   /customer/subscriptions#rb/detail/91
 *   /customer/subscriptions#rb/edit-plan/91
 *   /customer/subscriptions#rb/edit-item/91/3
 *
 * Also accepts legacy query (?page=detail&profile_id=91) and path overlays
 * (/customer/subscriptions/detail) when those documents exist.
 *
 * Magento → EDS page id:
 *   profile/index                → list (no hash)
 *   profile_edit/index           → detail
 *   profile_edit/plan            → edit-plan
 *   profile_edit/address         → edit-address
 *   profile_edit/payment         → edit-payment
 *   profile_edit/nextPaymentDate → edit-next-payment-date
 *   profile_edit/item            → edit-item
 */

export const SUBSCRIPTIONS_LIST_PATH = '/customer/subscriptions';

/** Hash prefix: #rb/<pageId>/<profileId>/<itemId?> */
export const ACCOUNT_HASH_PREFIX = 'rb';

/** Legacy query key (still read for old bookmarks). */
export const ACCOUNT_PAGE_QUERY_KEY = 'page';

/**
 * @typedef {
 *   'detail'
 *   |'edit-plan'
 *   |'edit-address'
 *   |'edit-payment'
 *   |'edit-next-payment-date'
 *   |'edit-item'
 * } SubscriptionAccountPageId
 */

/**
 * @type {ReadonlyArray<{
 *   id: SubscriptionAccountPageId,
 *   path: string,
 *   daPath: string,
 *   title: string,
 *   magento: string,
 * }>}
 */
export const SUBSCRIPTION_ACCOUNT_PAGES = Object.freeze([
  {
    id: 'detail',
    path: `${SUBSCRIPTIONS_LIST_PATH}/detail`,
    daPath: 'customer/subscriptions/detail.html',
    title: 'Subscription',
    magento: 'aw_sarp2/profile_edit/index',
  },
  {
    id: 'edit-plan',
    path: `${SUBSCRIPTIONS_LIST_PATH}/edit-plan`,
    daPath: 'customer/subscriptions/edit-plan.html',
    title: 'Edit Subscription Plan',
    magento: 'aw_sarp2/profile_edit/plan',
  },
  {
    id: 'edit-address',
    path: `${SUBSCRIPTIONS_LIST_PATH}/edit-address`,
    daPath: 'customer/subscriptions/edit-address.html',
    title: 'Edit Shipping Address',
    magento: 'aw_sarp2/profile_edit/address',
  },
  {
    id: 'edit-payment',
    path: `${SUBSCRIPTIONS_LIST_PATH}/edit-payment`,
    daPath: 'customer/subscriptions/edit-payment.html',
    title: 'Edit Payment Details',
    magento: 'aw_sarp2/profile_edit/payment',
  },
  {
    id: 'edit-next-payment-date',
    path: `${SUBSCRIPTIONS_LIST_PATH}/edit-next-payment-date`,
    daPath: 'customer/subscriptions/edit-next-payment-date.html',
    title: 'Edit Next Payment Date',
    magento: 'aw_sarp2/profile_edit/nextPaymentDate',
  },
  {
    id: 'edit-item',
    path: `${SUBSCRIPTIONS_LIST_PATH}/edit-item`,
    daPath: 'customer/subscriptions/edit-item.html',
    title: 'Edit Subscription Item',
    magento: 'aw_sarp2/profile_edit/item',
  },
]);

const PAGE_IDS = new Set(SUBSCRIPTION_ACCOUNT_PAGES.map((page) => page.id));

/**
 * @param {string} [search]
 * @returns {URLSearchParams}
 */
function parseSearch(search) {
  let raw = '';
  if (search != null) {
    raw = search;
  } else if (typeof window !== 'undefined') {
    raw = window.location.search;
  }
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
}

/**
 * @param {string} [hash]
 * @returns {{
 *   pageId: SubscriptionAccountPageId|null,
 *   profileId: string|null,
 *   itemId: string|null,
 * }}
 */
export function readAccountRouteFromHash(hash) {
  let raw = '';
  if (hash != null) {
    raw = hash;
  } else if (typeof window !== 'undefined') {
    raw = window.location.hash;
  }
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  const match = body.match(
    new RegExp(`^${ACCOUNT_HASH_PREFIX}/([a-z0-9-]+)(?:/([^/]+))?(?:/([^/]+))?$`, 'i'),
  );
  if (!match) {
    return { pageId: null, profileId: null, itemId: null };
  }
  const rawPageId = match[1];
  if (!PAGE_IDS.has(rawPageId)) {
    return { pageId: null, profileId: null, itemId: null };
  }
  /** @type {SubscriptionAccountPageId} */
  const pageId = /** @type {SubscriptionAccountPageId} */ (rawPageId);
  return {
    pageId,
    profileId: match[2] || null,
    itemId: match[3] || null,
  };
}

/**
 * @param {string} [search]
 * @returns {SubscriptionAccountPageId|null}
 */
export function readAccountPageFromSearch(search) {
  const value = parseSearch(search).get(ACCOUNT_PAGE_QUERY_KEY);
  if (!value) return null;
  return PAGE_IDS.has(value) ? /** @type {SubscriptionAccountPageId} */ (value) : null;
}

/**
 * Resolve scaffold page: hash first, then ?page=, then path segments.
 *
 * @param {string} [pathname]
 * @param {string} [search]
 * @param {string} [hash]
 * @returns {SubscriptionAccountPageId|null}
 */
export function resolveSubscriptionAccountPageId(pathname, search, hash) {
  const fromHash = readAccountRouteFromHash(hash);
  if (fromHash.pageId) return fromHash.pageId;

  const fromQuery = readAccountPageFromSearch(search);
  if (fromQuery) return fromQuery;

  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  const normalized = path.endsWith('.html') ? path.slice(0, -5) : path;
  const match = SUBSCRIPTION_ACCOUNT_PAGES.find((page) => (
    normalized === page.path || normalized.endsWith(page.path)
  ));
  return match ? match.id : null;
}

/**
 * @param {SubscriptionAccountPageId} pageId
 * @returns {(typeof SUBSCRIPTION_ACCOUNT_PAGES)[number]|undefined}
 */
export function getSubscriptionAccountPage(pageId) {
  return SUBSCRIPTION_ACCOUNT_PAGES.find((page) => page.id === pageId);
}

/**
 * @param {string|number|null|undefined} profileId
 * @param {string|number|null|undefined} [itemId]
 * @param {SubscriptionAccountPageId|null|undefined} [pageId]
 * @returns {string}
 */
export function buildProfileQuery(profileId, itemId, pageId) {
  const params = new URLSearchParams();
  if (pageId) {
    params.set(ACCOUNT_PAGE_QUERY_KEY, pageId);
  }
  if (profileId != null && String(profileId) !== '') {
    params.set('profile_id', String(profileId));
  }
  if (itemId != null && String(itemId) !== '') {
    params.set('item_id', String(itemId));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Href for list / detail / edit on the single published list document.
 *
 * @param {SubscriptionAccountPageId|'list'} pageId
 * @param {{
 *   profileId?: string|number|null,
 *   itemId?: string|number|null,
 *   rootLink?: (path: string) => string,
 * }} [options]
 * @returns {string}
 */
export function subscriptionAccountHref(pageId, options = {}) {
  const rootLink = typeof options.rootLink === 'function'
    ? options.rootLink
    : (path) => path;
  if (pageId === 'list' || !getSubscriptionAccountPage(pageId)) {
    return rootLink(SUBSCRIPTIONS_LIST_PATH);
  }
  const profile = options.profileId != null && String(options.profileId) !== ''
    ? encodeURIComponent(String(options.profileId))
    : '';
  const item = options.itemId != null && String(options.itemId) !== ''
    ? `/${encodeURIComponent(String(options.itemId))}`
    : '';
  const hash = profile
    ? `#${ACCOUNT_HASH_PREFIX}/${pageId}/${profile}${item}`
    : `#${ACCOUNT_HASH_PREFIX}/${pageId}`;
  return rootLink(`${SUBSCRIPTIONS_LIST_PATH}${hash}`);
}

/**
 * Read profile_id / item_id from hash, then query string.
 *
 * @param {string} [search]
 * @param {string} [hash]
 * @returns {{ profileId: string|null, itemId: string|null }}
 */
export function readSubscriptionAccountQuery(search, hash) {
  const fromHash = readAccountRouteFromHash(hash);
  if (fromHash.profileId || fromHash.itemId) {
    return {
      profileId: fromHash.profileId,
      itemId: fromHash.itemId,
    };
  }
  const params = parseSearch(search);
  const profileId = params.get('profile_id');
  const itemId = params.get('item_id');
  return {
    profileId: profileId && profileId.trim() !== '' ? profileId.trim() : null,
    itemId: itemId && itemId.trim() !== '' ? itemId.trim() : null,
  };
}
