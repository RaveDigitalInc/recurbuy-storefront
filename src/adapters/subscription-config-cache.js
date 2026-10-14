import { SUBSCRIPTION_REQUEST_TIMEOUT_MS, getValidSubscriptionConfig } from '../config.js';

/** @type {Map<string, Record<string, unknown>>} */
const payloadCache = new Map();
/** @type {Map<string, Promise<Record<string, unknown>>>} */
const inflight = new Map();

/**
 * One GET per catalog product id for the page lifetime. PDP and cart share this.
 * Non-OK responses reject with `{ status }` so eligibility can map 404/422.
 *
 * @param {number|string|null|undefined} productId
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadCachedSubscriptionConfig(productId) {
  const id = String(productId ?? '').trim();
  if (!id || id === '0' || !/^\d+$/.test(id)) {
    const err = /** @type {Error & { status?: number }} */ (new Error('NOT_FOUND'));
    err.status = 404;
    throw err;
  }

  if (payloadCache.has(id)) {
    return /** @type {Record<string, unknown>} */ (payloadCache.get(id));
  }

  const pending = inflight.get(id);
  if (pending) return pending;

  const promise = requestSubscriptionConfig(id)
    .then((payload) => {
      payloadCache.set(id, payload);
      return payload;
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, promise);
  return promise;
}

/**
 * Soft cart hydration: missing / ineligible product → null, no throw.
 *
 * @param {number|string|null|undefined} productId
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function loadCachedSubscriptionConfigSoft(productId) {
  try {
    return await loadCachedSubscriptionConfig(productId);
  } catch {
    return null;
  }
}

/**
 * @param {number|string|null|undefined} productId
 * @returns {Record<string, unknown>|null}
 */
export function peekCachedSubscriptionConfig(productId) {
  const id = String(productId ?? '').trim();
  if (!id || !payloadCache.has(id)) return null;
  return payloadCache.get(id) || null;
}

/**
 * @param {string} productId
 * @returns {Promise<Record<string, unknown>>}
 */
async function requestSubscriptionConfig(productId) {
  const config = getValidSubscriptionConfig();

  const url = new URL(
    `/api/recurbuy/storefront/products/${encodeURIComponent(productId)}/subscription-config`,
    config.storefrontUrl,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'X-RecurBuy-Connection-Token': config.connectionToken,
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      const err = /** @type {Error & { status?: number }} */ (new Error('NOT_FOUND'));
      err.status = 404;
      throw err;
    }

    if (response.status === 422) {
      const err = /** @type {Error & { status?: number }} */ (new Error('NOT_ELIGIBLE'));
      err.status = 422;
      throw err;
    }

    if (!response.ok) {
      const err = /** @type {Error & { status?: number }} */ (
        new Error(`Storefront API returned status ${response.status}.`)
      );
      err.status = response.status;
      throw err;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      const err = /** @type {Error & { status?: number }} */ (new Error('NOT_FOUND'));
      err.status = 404;
      throw err;
    }

    return /** @type {Record<string, unknown>} */ (payload);
  } finally {
    clearTimeout(timer);
  }
}
