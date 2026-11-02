import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';
import { storefrontRequestHeaders } from './storefront-request-headers.js';

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
  return storefrontRequestHeaders({ authToken });
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

/**
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<object>}
 */
export async function cancelShopperProfile({ authToken, profileId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/cancel`),
    authToken,
    {},
  );
}

/**
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<object>}
 */
export async function skipShopperNextOrder({ authToken, profileId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/skip-next-order`),
    authToken,
    {},
  );
}

/**
 * @param {{ authToken: string, profileId: number, itemId: number }} params
 * @returns {Promise<object>}
 */
export async function skipShopperProfileItem({ authToken, profileId, itemId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/items/${itemId}/skip`),
    authToken,
    {},
  );
}

/**
 * @param {{ authToken: string, profileId: number, itemId: number }} params
 * @returns {Promise<object>}
 */
export async function unskipShopperProfileItem({ authToken, profileId, itemId }) {
  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/items/${itemId}/unskip`),
    authToken,
    {},
  );
}

/**
 * @param {{ authToken: string, profileId: number, itemId: number }} params
 * @returns {Promise<object>}
 */
export async function removeShopperProfileItem({ authToken, profileId, itemId }) {
  return storefrontFetch(
    'DELETE',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/items/${itemId}`),
    authToken,
  );
}

/**
 * Same ChangePlanAvailablePlansBuilder as merchant GET …/available-plans.
 *
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export async function fetchShopperAvailablePlans({ authToken, profileId }) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  const payload = await storefrontFetch(
    'GET',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/available-plans`),
    authToken,
  );
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  /** @type {Array<{ id: number, name: string }>} */
  const plans = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') continue;
    const id = Number(row.id);
    if (!Number.isFinite(id) || id < 1) continue;
    const name = typeof row.name === 'string' && row.name.trim() !== ''
      ? row.name.trim()
      : `Plan #${id}`;
    plans.push({ id, name });
  }
  return plans;
}

/**
 * Same hub as merchant POST …/profiles/{id}/plan — ProfileService::changeSubscriptionPlan.
 *
 * @param {{ authToken: string, profileId: number, newPlanId: number }} params
 * @returns {Promise<object>}
 */
export async function changeShopperProfilePlan({ authToken, profileId, newPlanId }) {
  const planId = Number(newPlanId);
  if (!Number.isFinite(planId) || planId < 1) {
    throw new Error('A subscription plan is required.');
  }

  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/plan`),
    authToken,
    { new_plan_id: planId },
  );
}

/**
 * Same hub as merchant POST …/profiles/{id}/next-payment-date — ProfileService::changeNextPaymentDate.
 *
 * @param {{ authToken: string, profileId: number, newNextPaymentDate: string }} params
 * @returns {Promise<object>}
 */
export async function changeShopperNextPaymentDate({ authToken, profileId, newNextPaymentDate }) {
  const value = typeof newNextPaymentDate === 'string' ? newNextPaymentDate.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error('Next payment date must be UTC Y-m-d H:i:s.');
  }

  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/next-payment-date`),
    authToken,
    { new_next_payment_date: value },
  );
}

/**
 * @typedef {object} StorefrontSavedPaymentToken
 * @property {string} public_hash
 * @property {string} payment_method_code
 * @property {string} type
 * @property {Record<string, unknown>|null} details
 * @property {string} label
 */

/**
 * Soft-compat offline row shape (config keeps `payment_methods: []`).
 *
 * @typedef {object} StorefrontPaymentEditMethod
 * @property {string} code
 * @property {string} title
 * @property {boolean} [is_offline]
 */

/**
 * @typedef {object} StorefrontPaymentEditConfig
 * @property {number} [profile_id]
 * @property {boolean} [is_edit_payment_available]
 * @property {{
 *   payment_method?: string|null,
 *   payment_method_title?: string|null,
 *   payment_token_id?: string|number|null,
 *   payment_public_hash?: string|null,
 * }} [current]
 * @property {StorefrontPaymentEditMethod[]} [payment_methods]
 * @property {StorefrontSavedPaymentToken[]} [saved_payment_tokens]
 * @property {object} [totals]
 */

/**
 * Shopper GET …/profiles/{id}/payment-edit-config — saved vault cards + soft-empty payment_methods.
 *
 * @param {{ authToken: string, profileId: number }} params
 * @returns {Promise<StorefrontPaymentEditConfig>}
 */
export async function fetchShopperPaymentEditConfig({ authToken, profileId }) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  const payload = await storefrontFetch(
    'GET',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/payment-edit-config`),
    authToken,
  );

  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : (payload && typeof payload === 'object' ? payload : {});

  const rawMethods = Array.isArray(data.payment_methods) ? data.payment_methods : [];
  /** @type {StorefrontPaymentEditMethod[]} */
  const paymentMethods = [];
  for (const row of rawMethods) {
    if (row == null || typeof row !== 'object') continue;
    const code = typeof row.code === 'string' ? row.code.trim() : '';
    if (code === '') continue;
    const title = typeof row.title === 'string' && row.title.trim() !== ''
      ? row.title.trim()
      : code;
    paymentMethods.push({
      code,
      title,
      is_offline: Boolean(row.is_offline),
    });
  }

  const rawTokens = Array.isArray(data.saved_payment_tokens) ? data.saved_payment_tokens : [];
  /** @type {StorefrontSavedPaymentToken[]} */
  const savedPaymentTokens = [];
  for (const row of rawTokens) {
    if (row == null || typeof row !== 'object') continue;
    const publicHash = typeof row.public_hash === 'string' ? row.public_hash.trim() : '';
    if (publicHash === '') continue;
    const paymentMethodCode = typeof row.payment_method_code === 'string'
      ? row.payment_method_code.trim()
      : '';
    const type = typeof row.type === 'string' ? row.type.trim() : '';
    const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? /** @type {Record<string, unknown>} */ (row.details)
      : null;
    const label = typeof row.label === 'string' && row.label.trim() !== ''
      ? row.label.trim()
      : publicHash.slice(0, 8);
    savedPaymentTokens.push({
      public_hash: publicHash,
      payment_method_code: paymentMethodCode,
      type,
      details,
      label,
    });
  }

  const current = data.current && typeof data.current === 'object' ? data.current : {};
  const currentHash = typeof current.payment_public_hash === 'string'
    ? current.payment_public_hash.trim()
    : '';

  return {
    ...data,
    profile_id: Number(data.profile_id) || Number(profileId),
    is_edit_payment_available: Boolean(data.is_edit_payment_available),
    current: {
      payment_method: typeof current.payment_method === 'string' ? current.payment_method : null,
      payment_method_title: typeof current.payment_method_title === 'string'
        ? current.payment_method_title
        : null,
      payment_token_id: current.payment_token_id ?? null,
      payment_public_hash: currentHash !== '' ? currentHash : null,
    },
    payment_methods: paymentMethods,
    saved_payment_tokens: savedPaymentTokens,
    totals: data.totals && typeof data.totals === 'object' ? data.totals : {},
  };
}

/**
 * Shopper POST …/profiles/{id}/payment — select a saved vault card by public_hash.
 *
 * @param {{
 *   authToken: string,
 *   profileId: number,
 *   publicHash: string,
 *   paymentMethodCode?: string|null,
 * }} params
 * @returns {Promise<object>}
 */
export async function changeShopperSavedPaymentCard({
  authToken,
  profileId,
  publicHash,
  paymentMethodCode = null,
}) {
  const hash = typeof publicHash === 'string' ? publicHash.trim() : '';
  if (hash === '') {
    throw new Error('A saved payment card is required.');
  }

  /** @type {{ payment_public_hash: string, payment_method?: string }} */
  const body = { payment_public_hash: hash };
  const method = typeof paymentMethodCode === 'string' ? paymentMethodCode.trim() : '';
  if (method !== '') {
    body.payment_method = method;
  }

  return storefrontFetch(
    'POST',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profileId}/payment`),
    authToken,
    body,
  );
}

/**
 * Same schema as merchant GET …/products/{id}/order-create-config.
 *
 * @param {{
 *   authToken?: string,
 *   productId: number,
 *   storeId?: number|null,
 *   planId?: number|null,
 *   websiteId?: number|null,
 * }} params
 * @returns {Promise<object>}
 */
export async function fetchShopperProductConfigure({
  authToken,
  productId,
  storeId = null,
  planId = null,
  websiteId = null,
}) {
  const pid = Number(productId);
  if (!Number.isFinite(pid) || pid < 1) {
    throw new Error('A catalog product is required.');
  }

  const query = {};
  if (storeId != null && Number(storeId) > 0) {
    query.store_id = Number(storeId);
  }
  if (planId != null && Number(planId) > 0) {
    query.plan_id = Number(planId);
  }
  if (websiteId != null && Number(websiteId) >= 0) {
    query.website_id = Number(websiteId);
  }

  const payload = await storefrontFetch(
    'GET',
    storefrontUrl(`/api/recurbuy/storefront/products/${pid}/configure`, query),
    authToken,
  );

  if (payload?.data && typeof payload.data === 'object') {
    return payload.data;
  }
  return payload && typeof payload === 'object' ? payload : {};
}

/**
 * Magento Save/Item — ProfileService::changeProductItem.
 *
 * @param {{
 *   authToken: string,
 *   profileId: number,
 *   itemId: number,
 *   buyRequest: Record<string, unknown>,
 *   isOneTimeOnly?: boolean,
 * }} params
 * @returns {Promise<object>}
 */
export async function changeShopperProfileItem({
  authToken,
  profileId,
  itemId,
  buyRequest,
  isOneTimeOnly = false,
}) {
  if (!authToken) {
    const error = new Error('Shopper authentication required.');
    error.status = 401;
    throw error;
  }

  const profile = Number(profileId);
  const item = Number(itemId);
  if (!Number.isFinite(profile) || profile < 1 || !Number.isFinite(item) || item < 1) {
    throw new Error('Profile item is required.');
  }

  return storefrontFetch(
    'PUT',
    storefrontUrl(`/api/recurbuy/storefront/profiles/${profile}/items/${item}`),
    authToken,
    {
      buy_request: buyRequest && typeof buyRequest === 'object' ? buyRequest : {},
      is_one_time_only: Boolean(isOneTimeOnly),
    },
  );
}
