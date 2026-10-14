import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';

/**
 * Plan titles for a simple product live in subscription-options-list HTML.
 * subscription-config prices the plans but does not include frontend titles.
 *
 * @typedef {Object} SubscriptionOptionList
 * @property {Record<string, string>} titles Option id → plan title
 * @property {boolean} [allowOneTime] True when the list starts with the one-off row
 * @property {'radiobutton'|'dropdown'} [renderer]
 * @property {{ text?: string, tooltip?: string, isVisible?: boolean }} [subscribeAndSave]
 */

/** @type {Map<string, SubscriptionOptionList>} */
const cache = new Map();
/** @type {Map<string, Promise<SubscriptionOptionList|null>>} */
const inflight = new Map();

/**
 * @param {string|undefined|null} html
 * @returns {Record<string, string>}
 */
function parseSubscriptionOptionListHtml(html) {
  if (typeof html !== 'string' || !html.trim() || typeof DOMParser === 'undefined') return {};
  return parseWithDom(html);
}

/**
 * @param {Record<string, unknown>|null|undefined} payload
 * @returns {SubscriptionOptionList|null}
 */
function readSubscriptionOptionList(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const {
    subscribeAndSave,
    html,
    isFirstOptionNoPlan,
    titles,
    renderer,
  } = payload;
  const fromHtml = parseSubscriptionOptionListHtml(typeof html === 'string' ? html : '');
  const normalizedRenderer = normalizeRenderer(renderer);
  return {
    titles: { ...fromHtml, ...asTitleMap(titles) },
    ...(typeof isFirstOptionNoPlan === 'boolean' && {
      allowOneTime: isFirstOptionNoPlan,
    }),
    ...(normalizedRenderer && { renderer: normalizedRenderer }),
    ...(subscribeAndSave && typeof subscribeAndSave === 'object' && { subscribeAndSave }),
  };
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function asTitleMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  /** @type {Record<string, string>} */
  const titles = {};
  Object.entries(value).forEach(([id, title]) => {
    if (!id || id === '0' || typeof title !== 'string' || !title.trim()) return;
    titles[id] = title.trim();
  });
  return titles;
}

/**
 * Magento product_page/subscription_options_renderer values for the drop-in.
 * @param {unknown} renderer
 * @returns {'radiobutton'|'dropdown'|undefined}
 */
function normalizeRenderer(renderer) {
  if (typeof renderer !== 'string') return undefined;
  const value = renderer.trim().toLowerCase();
  if (value === 'dropdown' || value === 'configurable-dropdown') return 'dropdown';
  if (value === 'radiobutton' || value === 'configurable-radiobutton') return 'radiobutton';
  return undefined;
}

/**
 * @param {number|string|null|undefined} productId
 * @returns {Promise<SubscriptionOptionList|null>}
 */
export async function fetchSubscriptionOptionList(productId) {
  const id = String(productId ?? '').trim();
  if (!id || id === '0' || !/^\d+$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id) || null;
  if (inflight.has(id)) return inflight.get(id) || null;

  const promise = loadSubscriptionOptionList(id)
    .then((result) => {
      if (result) cache.set(id, result);
      return result;
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, promise);
  return promise;
}

/**
 * @param {string} productId
 * @returns {Promise<SubscriptionOptionList|null>}
 */
async function loadSubscriptionOptionList(productId) {
  let config;
  try {
    config = getValidSubscriptionConfig();
  } catch {
    return null;
  }

  const url = new URL(
    `/api/recurbuy/storefront/products/${encodeURIComponent(productId)}/subscription-options-list`,
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

    if (!response.ok) return null;
    return readSubscriptionOptionList(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} html
 * @returns {Record<string, string>}
 */
function parseWithDom(html) {
  const titles = {};
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('input[name="aw_sarp2_subscription_type"]').forEach((input) => {
    const id = input.getAttribute('value');
    if (!id || id === '0' || titles[id]) return;
    const label = input.parentElement?.querySelector('label span')?.textContent?.trim();
    if (label) titles[id] = label;
  });

  doc.querySelectorAll('select.aw-sarp2-subscription__options-list option').forEach((option) => {
    const id = option.getAttribute('value');
    if (!id || id === '0' || titles[id]) return;
    const label = option.textContent?.trim();
    if (label) titles[id] = label;
  });

  return titles;
}
