import { getShopperAuthToken } from './auth.js';
import { mountCustomerIframe } from './customer-iframe-host.js';

/**
 * Customer account "My Subscriptions" — panel customer iframe.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 * }} [options]
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountSubscriptionsList(rootEl, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionsList requires a DOM element.');
  }

  return mountCustomerIframe(rootEl, {
    page: 'list',
    getAuthToken: typeof options.getAuthToken === 'function'
      ? options.getAuthToken
      : getShopperAuthToken,
    onUnauthenticated: options.onUnauthenticated,
  });
}
