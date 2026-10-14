import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';

/**
 * @typedef {object} StorefrontProfileListProduct
 * @property {number} product_id
 * @property {string} name
 */

/**
 * @typedef {object} StorefrontProfileListNextPayment
 * @property {string|null} [payment_status]
 * @property {string|null} [payment_period]
 * @property {string|null} [payment_date]
 * @property {number|string|null} [amount]
 * @property {boolean} [is_last_next_payment]
 * @property {boolean} [is_membership_next_payment]
 * @property {boolean} [is_trial_period_active]
 */

/**
 * @typedef {object} StorefrontProfileListRow
 * @property {number} profile_id
 * @property {string} [increment_id]
 * @property {string} [status]
 * @property {string} [plan_name]
 * @property {StorefrontProfileListProduct[]} [products]
 * @property {string|null} [trial_end_date]
 * @property {string|null} [last_payment_date]
 * @property {StorefrontProfileListNextPayment|null} [next_payment]
 * @property {Record<string, boolean>|null} [actions]
 */

/**
 * @typedef {object} StorefrontProfileListResult
 * @property {StorefrontProfileListRow[]} data
 * @property {{
 *   current_page: number,
 *   last_page: number,
 *   per_page: number,
 *   total: number,
 *   are_show_canceled_subscriptions: number,
 * }} meta
 */

/**
 * @param {string|undefined} authToken
 * @returns {Record<string, string>}
 */
function shopperHeaders(authToken) {
  const config = getValidSubscriptionConfig();
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json',
    'X-RecurBuy-Connection-Token': config.connectionToken,
  };
  if (authToken) {
    // Magento shopper identity (L-113): never put customer_id in query/body.
    headers.Authorization = `Bearer ${authToken}`;
    // Same JWT, explicit RecurBuy header (visible in DevTools; lab parity).
    headers['X-RecurBuy-Customer-Token'] = authToken;
  }
  return headers;
}

/**
 * @param {string} path
 * @param {Record<string, string|number|undefined|null>} [query]
 * @returns {URL}
 */
function storefrontUrl(path, query = {}) {
  const config = getValidSubscriptionConfig();
  const url = new URL(path, `${config.storefrontUrl}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url;
}

/**
 * @template T
 * @param {string} method
 * @param {URL} url
 * @param {string|undefined} authToken
 * @param {object} [body]
 * @returns {Promise<T>}
 */
async function storefrontFetch(method, url, authToken, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method,
      credentials: 'omit',
      headers: {
        ...shopperHeaders(authToken),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.message === 'string' && payload.message
        ? payload.message
        : `Storefront request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Magento `GET aw_sarp2/profile` list parity.
 *
 * @param {{
 *   authToken: string,
 *   page?: number,
 *   perPage?: number,
 *   showCanceled?: boolean|null,
 * }} params
 * @returns {Promise<StorefrontProfileListResult>}
 */
export async function fetchShopperProfilesList({
  authToken,
  page = 1,
  perPage = 10,
  showCanceled = null,
}) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  const query = {
    page,
    per_page: perPage,
  };
  if (showCanceled !== null && showCanceled !== undefined) {
    query.are_show_canceled_subscriptions = showCanceled ? 1 : 0;
  }

  const payload = await storefrontFetch(
    'GET',
    storefrontUrl('/api/recurbuy/storefront/profiles', query),
    authToken,
  );

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};

  return {
    data,
    meta: {
      current_page: Number(meta.current_page) || page,
      last_page: Number(meta.last_page) || 1,
      per_page: Number(meta.per_page) || perPage,
      total: Number(meta.total) || data.length,
      are_show_canceled_subscriptions: Number(meta.are_show_canceled_subscriptions) ? 1 : 0,
    },
  };
}

/**
 * Persist Magento `are_show_canceled_subscriptions` customer option.
 *
 * @param {{ authToken: string, value: boolean }} params
 * @returns {Promise<void>}
 */
export async function persistShowCanceledSubscriptions({ authToken, value }) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  await storefrontFetch(
    'POST',
    storefrontUrl('/api/recurbuy/storefront/customer/options'),
    authToken,
    {
      option: {
        key: 'are_show_canceled_subscriptions',
        value: value ? '1' : '0',
      },
    },
  );
}

/**
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<{ data: object }>}
 */
export async function fetchShopperProfileDetail({ authToken, profileId }) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  return storefrontFetch(
    'GET',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}`),
    authToken,
  );
}

/**
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<object>}
 */
export async function renewShopperProfile({ authToken, profileId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/renew`),
    authToken,
    {},
  );
}

/**
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<object>}
 */
export async function extendShopperProfile({ authToken, profileId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/extend`),
    authToken,
    {},
  );
}
