import { SUBSCRIPTION_ERROR_CODES } from '../contract.js';
import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';
import {
  configHasSubscriptionPlansForChild,
  mapStorefrontPayloadToEligibility,
} from './storefront-pdp-mapper.js';
import { fetchSubscriptionOptionList } from './storefront-options-list.js';
import {
  loadCachedSubscriptionConfig,
  peekCachedSubscriptionConfig,
} from './subscription-config-cache.js';

/** Edit-item / option-scoped payloads only (bare product id uses the shared cache). */
/** @type {Map<string, Record<string, unknown>>} */
const configPayloadCache = new Map();
/** @type {Map<string, Promise<Record<string, unknown>>>} */
const configInflight = new Map();

/**
 * Last successful subscription-config for a catalog product (parent id for configurables).
 * @param {number|string|null|undefined} productId
 * @param {string|undefined} [selectedChildId]
 * @returns {boolean|null} true/false when known, null when no cache yet
 */
export function peekConfigHasPlansForChild(productId, selectedChildId) {
  const id = String(productId ?? '').trim();
  const payload = peekCachedSubscriptionConfig(id) || configPayloadCache.get(id);
  if (!id || !payload) return null;
  return configHasSubscriptionPlansForChild(payload, selectedChildId);
}

/**
 * Config already carries Magento product-page UI (renderer + Subscribe & Save).
 * @param {Record<string, unknown>} payload
 * @returns {boolean}
 */
function configHasProductPageUi(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.renderer !== 'string' || !payload.renderer.trim()) return false;
  const sas = payload.subscribeAndSave;
  return Boolean(sas && typeof sas === 'object');
}

/**
 * Magento simple/generic PDP often omits planOptions — plan titles live only in
 * options-list HTML. Configurable AccS usually embeds titles on nested planOptions.
 * @param {Record<string, unknown>} payload
 * @returns {boolean}
 */
function payloadNeedsOptionListTitles(payload) {
  if (!payload || typeof payload !== 'object') return true;
  const options = /** @type {Record<string, unknown>} */ (
    payload.options || payload.regularPrices?.options || {}
  );
  const optionKeys = Object.keys(options || {}).filter((key) => key !== '0');
  if (optionKeys.length === 0) return false;

  const { planOptions } = payload;
  if (!planOptions || typeof planOptions !== 'object') return true;

  const hasTitle = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { title } = /** @type {{ title?: string }} */ (entry);
    return typeof title === 'string' && Boolean(title.trim());
  };

  const planOptionRecord = /** @type {Record<string, unknown>} */ (planOptions);
  const nestedBuckets = Object.values(planOptionRecord).filter(
    (bucket) => bucket
      && typeof bucket === 'object'
      && !Array.isArray(bucket)
      && !hasTitle(bucket)
      && !('plan_id' in /** @type {object} */ (bucket)),
  );

  return optionKeys.some((key) => {
    if (hasTitle(planOptionRecord[key])) return false;
    return !nestedBuckets.some(
      (bucket) => hasTitle(/** @type {Record<string, unknown>} */ (bucket)[key]),
    );
  });
}

/**
 * @param {Record<string, unknown>} payload
 * @param {import('../contract.js').SubscriptionEligibilityRequest} request
 * @param {number|string} productId
 * @returns {Promise<import('../contract.js').SubscriptionEligibilityResponse>}
 */
async function mapPayloadToResponse(payload, request, productId) {
  // Skip options-list only when UI is on config AND plan titles are already present
  // (configurable AccS). Simple products need options-list for "Monthly 12 (50%)" etc.
  let optionList = null;
  if (!configHasProductPageUi(payload) || payloadNeedsOptionListTitles(payload)) {
    optionList = await fetchSubscriptionOptionList(productId);
  }

  const eligibility = mapStorefrontPayloadToEligibility(
    payload,
    request.sku || String(productId),
    {
      ...(request.product || {}),
      externalId: String(productId),
      selectedChildExternalId: request.product?.selectedChildExternalId,
    },
    optionList,
  );

  return { data: eligibility };
}

/**
 * One network GET per parent product id; parallel callers share the same promise.
 * Selected child is applied in mapPayloadToResponse (no second HTTP).
 *
 * @param {string} productKey
 * @param {string} connectionToken
 * @param {URL} url
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadConfigPayload(productKey, connectionToken, url) {
  // Bare PDP product id — same in-flight GET as cart quote hydration.
  if (/^\d+$/.test(productKey)) {
    return loadCachedSubscriptionConfig(productKey);
  }

  const cached = configPayloadCache.get(productKey);
  if (cached) return cached;

  const pending = configInflight.get(productKey);
  if (pending) return pending;

  const controller = new AbortController();
  const timeoutMs = SUBSCRIPTION_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const promise = (async () => {
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          'X-RecurBuy-Connection-Token': connectionToken,
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
      configPayloadCache.set(productKey, payload);
      return payload;
    } finally {
      clearTimeout(timer);
      configInflight.delete(productKey);
    }
  })();

  configInflight.set(productKey, promise);
  return promise;
}

/**
 * @param {import('../contract.js').SubscriptionEligibilityRequest} request
 * @returns {Promise<import('../contract.js').SubscriptionEligibilityResponse>}
 */
export async function fetchEligibility(request) {
  const productId = request?.product?.externalId || request?.productId;
  if (!productId) {
    return {
      error: {
        code: SUBSCRIPTION_ERROR_CODES.INVALID_REQUEST,
        message: 'Product ID (externalId) is required to fetch subscription eligibility.',
      },
    };
  }

  let config;
  try {
    config = getValidSubscriptionConfig();
  } catch (err) {
    return {
      error: {
        code: SUBSCRIPTION_ERROR_CODES.INVALID_REQUEST,
        message: err.message,
      },
    };
  }

  const url = new URL(
    `/api/recurbuy/storefront/products/${encodeURIComponent(productId)}/subscription-config`,
    config.storefrontUrl,
  );

  if (request.subscriptionOptionId) {
    url.searchParams.append('subscription_option_id', request.subscriptionOptionId);
  }

  if (request.context === 'edit_item') {
    url.searchParams.append('context', 'edit_item');
  }

  // Edit-item option id can change payload; PDP AccS uses bare product id.
  const productKey = request.context === 'edit_item' || request.subscriptionOptionId
    ? `${productId}|${request.subscriptionOptionId || 0}|edit`
    : String(productId);

  try {
    const payload = await loadConfigPayload(productKey, config.connectionToken, url);
    return mapPayloadToResponse(payload, request, productId);
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err
      ? Number(/** @type {{ status?: number }} */ (err).status)
      : 0;

    if (status === 404) {
      return {
        error: {
          code: SUBSCRIPTION_ERROR_CODES.NOT_FOUND,
          message: 'Subscription configuration not found for this product.',
        },
      };
    }

    if (status === 422) {
      return {
        error: {
          code: SUBSCRIPTION_ERROR_CODES.NOT_ELIGIBLE,
          message: `Product ${productId} is not eligible for subscriptions.`,
        },
      };
    }

    if (status > 0) {
      return {
        error: {
          code: SUBSCRIPTION_ERROR_CODES.SERVER,
          message: err instanceof Error ? err.message : `Storefront API returned status ${status}.`,
        },
      };
    }

    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      error: {
        code: SUBSCRIPTION_ERROR_CODES.NETWORK,
        message: aborted ? 'Request timed out.' : 'Unable to reach the Subscription Storefront API.',
      },
    };
  }
}
