/**
 * Checkout success subscription line (Magento SARP `profiles_info.phtml` parity).
 *
 * Renders "Your subscription profile is: <id>" right under the order number on
 * the checkout confirmation screen after `order/placed` (briefly polling while
 * the AccS post-order webhook creates the profile).
 */

import { subscriptionAccountHref } from '../account/subscription-routes.js';
import { getValidSubscriptionConfig, SUBSCRIPTION_REQUEST_TIMEOUT_MS } from '../config.js';
import { RECURBUY_SUBSCRIPTION_OPTION_ID } from '../contract.js';
import { escapeHtml } from '../helpers/dom-html.js';
import { ensureRecurBuyStyles } from '../helpers/ensure-styles.js';
import { hasRecurbuyLines } from '../recurbuy-line.js';

export const CHECKOUT_SUCCESS_BLOCK_CLASS = 'recurbuy-checkout-success';
const SUBSCRIPTION_POLL_DELAYS_MS = [0, 500, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
const FALLBACK_POLL_DELAYS_MS = [0, 800, 1500, 2500, 3500, 5000];
const ORDER_DATA_POLL_DELAYS_MS = [0, 800, 1500, 2500, 3500, 5000];
const SUBSCRIPTION_OPTION_VALUE_RE = /\[#\d+\]/;

function itemOptionsHaveSubscriptionMarker(options) {
  if (!Array.isArray(options)) return false;
  return options.some((opt) => {
    if (!opt || typeof opt !== 'object') return false;
    const label = String(opt.label ?? opt.title ?? '').trim().toLowerCase();
    const value = String(opt.value ?? '').trim();
    if (SUBSCRIPTION_OPTION_VALUE_RE.test(value)) return true;
    return label === 'subscription' && value !== '' && value.toLowerCase() !== 'one-time';
  });
}

function hasSubscriptionOptionInItems(items) {
  if (!Array.isArray(items)) return false;
  return items.some((item) => (
    item
    && typeof item === 'object'
    && (
      itemOptionsHaveSubscriptionMarker(item.selectedOptions)
      || itemOptionsHaveSubscriptionMarker(item.selected_options)
      || itemOptionsHaveSubscriptionMarker(item.enteredOptions)
      || itemOptionsHaveSubscriptionMarker(item.entered_options)
      || itemOptionsHaveSubscriptionMarker(item.customizableOptions)
      || itemOptionsHaveSubscriptionMarker(item.customizable_options)
    )
  ));
}

function cartHasSubscriptionMarker(cart) {
  if (!cart || typeof cart !== 'object') return false;
  if (hasRecurbuyLines(cart)) return true;
  if (hasSubscriptionOptionInItems(cart.items)) return true;
  if (hasSubscriptionOptionInItems(cart.itemsV2?.items)) return true;
  try {
    const serialized = JSON.stringify(cart);
    return serialized.includes(RECURBUY_SUBSCRIPTION_OPTION_ID)
      || serialized.includes('aw_sarp2_subscription_type')
      || SUBSCRIPTION_OPTION_VALUE_RE.test(serialized);
  } catch {
    return false;
  }
}

export function orderHasSubscriptionMarker(orderData) {
  if (!orderData || typeof orderData !== 'object') return false;
  if (hasSubscriptionOptionInItems(orderData.items)) return true;
  return cartHasSubscriptionMarker(orderData);
}

export function mapCheckoutSuccessPayload(payload) {
  const rawProfiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
  const profiles = rawProfiles
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const numericId = Number(entry.profile_id);
      const profileId = Number.isFinite(numericId) && numericId > 0 ? numericId : null;
      const incrementId = String(entry.increment_id ?? (profileId ?? '')).trim();
      return { profileId, incrementId };
    })
    .filter((item) => item.incrementId !== '');

  return {
    canViewProfiles: Boolean(payload?.can_view_profiles),
    profiles,
  };
}

export function buildCheckoutSuccessLoadingMarkup() {
  return '<p class="recurbuy-checkout-success__loading" role="status" aria-live="polite">'
    + '<span class="recurbuy-checkout-success__spinner" aria-hidden="true"></span>'
    + '<span>Loading subscription details…</span>'
    + '</p>';
}

export function buildCheckoutSuccessMarkup(data, { hasShopperSession = false, rootLink } = {}) {
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
  if (!profiles.length) return '';

  const canView = Boolean(data?.canViewProfiles) && hasShopperSession;
  const heading = profiles.length > 1
    ? 'Your subscription profiles are:'
    : 'Your subscription profile is:';

  const parts = profiles.map(({ profileId, incrementId }, index) => {
    const isLast = index >= profiles.length - 1;
    const label = escapeHtml(incrementId);
    if (canView && profileId) {
      const href = subscriptionAccountHref('detail', { profileId, rootLink });
      const sep = isLast ? '' : ',';
      return ` <a class="recurbuy-checkout-success__link" href="${escapeHtml(href)}">`
        + `<strong class="recurbuy-checkout-success__id">${label}</strong></a>${sep}`;
    }
    return ` <strong class="recurbuy-checkout-success__id">${label}</strong>${isLast ? '.' : ','}`;
  });

  return `<p class="recurbuy-checkout-success__text">${escapeHtml(heading)}${parts.join('')}</p>`;
}

function parseStrictEntityId(raw) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Ignore GraphQL UIDs and zero-padded increment IDs (e.g. "000000579").
    if (/^[1-9]\d*$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
    }
  }
  return null;
}

export function extractOrderLookup(orderData, search = '') {
  const rawNumber = orderData?.number ?? orderData?.increment_id ?? orderData?.orderNumber;
  let incrementId = rawNumber != null ? String(rawNumber).trim() : '';

  if (!incrementId && search) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const ref = (params.get('orderNumber') || params.get('orderRef') || '').trim();
    if (ref && ref.length <= 20) incrementId = ref;
  }

  // Adobe Commerce GraphQL `CustomerOrder.id` can be a base64 UID or a
  // zero-padded increment_id alias rather than the Commerce numeric entity_id.
  const orderId = parseStrictEntityId(orderData?.order_id)
    ?? (incrementId ? null : parseStrictEntityId(orderData?.id));

  return orderId || incrementId ? { orderId, incrementId } : null;
}

export function buildCheckoutSuccessRequestUrl(storefrontUrl, { orderId, incrementId }) {
  const url = new URL('/api/recurbuy/storefront/checkout/success', storefrontUrl);
  // Prefer increment_id when present: storefront GraphQL always provides the
  // authoritative order number, whereas `id` may not match Commerce entity_id.
  if (incrementId) {
    url.searchParams.set('increment_id', incrementId);
  } else if (orderId) {
    url.searchParams.set('order_id', String(orderId));
  }
  return url;
}

async function fetchSuccessJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'omit',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, payload: null };
    }
    return { ok: true, status: response.status, payload: await response.json() };
  } catch (error) {
    console.warn('RecurBuy checkout success request failed:', error);
    return { ok: false, status: 0, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultFetchProfiles({ orderId, incrementId, authToken }) {
  let config;
  try {
    config = getValidSubscriptionConfig();
  } catch {
    return null;
  }

  const url = buildCheckoutSuccessRequestUrl(config.storefrontUrl, { orderId, incrementId });

  const baseHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.connectionToken}`,
    'X-RecurBuy-Connection-Token': config.connectionToken,
  };
  const headers = authToken
    ? { ...baseHeaders, 'X-RecurBuy-Customer-Token': authToken }
    : baseHeaders;

  let outcome = await fetchSuccessJson(url, headers);
  if (!outcome.ok && outcome.status === 401 && authToken) {
    // Shopper token could not be verified on this store view; fall back to
    // connection-only lookup so the profile number still renders.
    outcome = await fetchSuccessJson(url, baseHeaders);
  }

  if (!outcome.ok) {
    if (outcome.status > 0) {
      console.warn('RecurBuy checkout success lookup returned HTTP', outcome.status);
    }
    return null;
  }

  return mapCheckoutSuccessPayload(outcome.payload);
}

function findMountTarget(rootDocument) {
  const confirmation = rootDocument?.querySelector('.order-confirmation');
  if (confirmation) {
    const header = confirmation.querySelector('.order-confirmation__header');
    const main = confirmation.querySelector('.order-confirmation__main') || confirmation;
    return {
      scope: confirmation,
      after: header && header.parentElement === main ? header : null,
      container: main,
    };
  }
  const orderHeader = rootDocument?.querySelector('.commerce-order-header');
  if (orderHeader?.parentElement) {
    return {
      scope: orderHeader.parentElement,
      after: orderHeader,
      container: orderHeader.parentElement,
    };
  }
  return null;
}

function mountBlock(rootDocument, markup) {
  const target = findMountTarget(rootDocument);
  if (!target) return;

  const existing = target.scope.querySelector(`.${CHECKOUT_SUCCESS_BLOCK_CLASS}`);
  if (!markup) {
    existing?.remove();
    return;
  }

  const host = existing instanceof HTMLElement
    ? existing
    : rootDocument.createElement('div');
  if (host.className !== CHECKOUT_SUCCESS_BLOCK_CLASS) {
    host.className = CHECKOUT_SUCCESS_BLOCK_CLASS;
  }
  if (host.getAttribute('data-testid') !== CHECKOUT_SUCCESS_BLOCK_CLASS) {
    host.setAttribute('data-testid', CHECKOUT_SUCCESS_BLOCK_CLASS);
  }
  // Avoid rewriting innerHTML when unchanged — unconditional innerHTML writes
  // mutate childList and trigger an infinite MutationObserver microtask loop.
  if (host.getAttribute('data-rb-markup') !== markup) {
    host.innerHTML = markup;
    host.setAttribute('data-rb-markup', markup);
  }

  // Insert as sibling after `.order-confirmation__header` (never inside it)
  // so Preact OrderHeader re-renders never wipe our node.
  if (target.after) {
    if (target.after.nextElementSibling !== host) {
      target.after.insertAdjacentElement('afterend', host);
    }
  } else if (host.parentElement !== target.container) {
    target.container.prepend(host);
  }
}

export function createCheckoutSuccessRuntime({
  events,
  fetchProfiles = defaultFetchProfiles,
  getAuthToken = () => undefined,
  getCartData = () => null,
  pollDelaysMs = SUBSCRIPTION_POLL_DELAYS_MS,
  fallbackPollDelaysMs = FALLBACK_POLL_DELAYS_MS,
  rootDocument = typeof document !== 'undefined' ? document : null,
  ensureStyles = ensureRecurBuyStyles,
  rootLink,
}) {
  let installed = false;
  let disposed = false;
  let cartHadSubscription = false;
  let runId = 0;
  let fetchedKey = '';
  let latestData = null;
  let showLoading = false;
  const subs = [];
  const timers = new Set();
  let observer = null;
  let painting = false;

  const wait = (ms) => new Promise((resolve) => {
    if (ms <= 0) { resolve(); return; }
    const id = setTimeout(() => { timers.delete(id); resolve(); }, ms);
    timers.add(id);
  });

  const paint = () => {
    if (disposed || painting || !rootDocument) return;
    if (!findMountTarget(rootDocument)) return;
    let markup = '';
    if (latestData?.profiles?.length) {
      markup = buildCheckoutSuccessMarkup(latestData, {
        hasShopperSession: Boolean(getAuthToken?.()),
        rootLink,
      });
    } else if (showLoading) {
      markup = buildCheckoutSuccessLoadingMarkup();
    }
    painting = true;
    try {
      if (markup) ensureStyles();
      mountBlock(rootDocument, markup);
    } finally {
      // Drain mutation records caused by our own DOM insert so the observer
      // cannot re-enter paint() in a microtask loop.
      observer?.takeRecords?.();
      painting = false;
    }
  };

  const rememberCart = (cartData) => {
    const cart = cartData || getCartData();
    if (!cart || typeof cart !== 'object') return;
    if (cartHasSubscriptionMarker(cart)) {
      cartHadSubscription = true;
    } else if (Array.isArray(cart.items) && cart.items.length > 0) {
      cartHadSubscription = false;
    }
  };

  const lookupKey = (lookup) => (lookup.incrementId ? `inc:${lookup.incrementId}` : `id:${lookup.orderId ?? ''}`);

  const loadProfiles = async (lookup, schedule, { showLoader = false } = {}) => {
    const key = lookupKey(lookup);
    if (key === fetchedKey && latestData?.profiles?.length) {
      paint();
      return;
    }

    fetchedKey = key;
    latestData = null;
    showLoading = Boolean(showLoader);
    runId += 1;
    const currentRun = runId;
    const authToken = getAuthToken?.() || null;

    if (showLoading) {
      paint();
    }

    try {
      for (let i = 0; i < schedule.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await wait(schedule[i]);
        if (disposed || currentRun !== runId) return;

        // eslint-disable-next-line no-await-in-loop
        const result = await fetchProfiles({ ...lookup, authToken });
        if (disposed || currentRun !== runId) return;

        if (result?.profiles?.length) {
          latestData = result;
          showLoading = false;
          paint();
          return;
        }
      }
    } finally {
      if (!disposed && currentRun === runId && showLoading) {
        showLoading = false;
        paint();
      }
    }
  };

  const onOrderPlaced = (orderData) => {
    if (disposed) return;
    const lookup = extractOrderLookup(orderData);
    const hadSub = cartHadSubscription
      || cartHasSubscriptionMarker(getCartData())
      || orderHasSubscriptionMarker(orderData);
    cartHadSubscription = false;
    if (!lookup) return;
    const schedule = hadSub ? pollDelaysMs : fallbackPollDelaysMs;
    if (!schedule.length) return;
    loadProfiles(lookup, schedule, { showLoader: hadSub }).catch((error) => {
      console.warn('RecurBuy checkout success lookup failed:', error);
    });
  };

  const onOrderData = (orderData) => {
    if (disposed || !findMountTarget(rootDocument)) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const lookup = extractOrderLookup(orderData, search);
    if (!lookup || lookupKey(lookup) === fetchedKey) return;
    const hadSub = cartHadSubscription
      || cartHasSubscriptionMarker(getCartData())
      || orderHasSubscriptionMarker(orderData);
    const schedule = hadSub ? pollDelaysMs : ORDER_DATA_POLL_DELAYS_MS;
    loadProfiles(lookup, schedule, { showLoader: hadSub }).catch((error) => {
      console.warn('RecurBuy checkout success lookup failed:', error);
    });
  };

  return {
    install() {
      if (installed || disposed) return;
      installed = true;
      rememberCart(events?.lastPayload?.('cart/data'));
      rememberCart(events?.lastPayload?.('checkout/initialized'));
      if (typeof events?.on === 'function') {
        subs.push(events.on('cart/data', rememberCart, { eager: true }));
        subs.push(events.on('checkout/initialized', rememberCart, { eager: true }));
        subs.push(events.on('checkout/updated', rememberCart, { eager: true }));
        subs.push(events.on('order/placed', onOrderPlaced, { eager: true }));
        subs.push(events.on('order/data', onOrderData, { eager: true }));
      }
      if (rootDocument?.body && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => {
          if (disposed) return;
          if (latestData?.profiles?.length || showLoading) {
            paint();
          } else if (!fetchedKey && findMountTarget(rootDocument)) {
            const lastOrder = events?.lastPayload?.('order/data');
            if (lastOrder) {
              onOrderData(lastOrder);
            } else if (typeof window !== 'undefined') {
              const fromUrl = extractOrderLookup(null, window.location.search);
              if (fromUrl) {
                loadProfiles(fromUrl, ORDER_DATA_POLL_DELAYS_MS).catch(() => {});
              }
            }
          }
        });
        observer.observe(rootDocument.body, { childList: true, subtree: true });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      runId += 1;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      subs.forEach((sub) => sub?.off?.());
      subs.length = 0;
      observer?.disconnect();
      observer = null;
      rootDocument?.querySelectorAll(`.${CHECKOUT_SUCCESS_BLOCK_CLASS}`)
        .forEach((node) => node.remove());
    },
  };
}

export function installCheckoutSuccessRuntime({ events, getAuthToken, getCartData } = {}) {
  if (typeof document === 'undefined' || !events) return () => {};
  const runtime = createCheckoutSuccessRuntime({
    events,
    getAuthToken,
    getCartData,
    rootDocument: document,
  });
  runtime.install();
  return () => runtime.dispose();
}
