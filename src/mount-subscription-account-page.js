import {
  readSubscriptionAccountQuery,
  resolveSubscriptionAccountPageId,
} from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { mountCustomerIframe } from './customer-iframe-host.js';

/**
 * Account subscription detail / edit pages — panel customer iframe.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   page?: import('./account/subscription-routes.js').SubscriptionAccountPageId,
 *   pathname?: string,
 *   search?: string,
 *   hash?: string,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 * }} [options]
 * @returns {{ destroy: () => void, refresh?: () => void }}
 */
export function mountSubscriptionAccountPage(rootEl, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionAccountPage requires a DOM element.');
  }

  const pathname = options.pathname
    ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const search = options.search
    ?? (typeof window !== 'undefined' ? window.location.search : '');
  const hash = options.hash
    ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const pageId = options.page
    || resolveSubscriptionAccountPageId(pathname, search, hash);
  if (!pageId) {
    rootEl.innerHTML = '<div class="message error"><span>Unknown subscription account page.</span></div>';
    return {
      destroy() {
        rootEl.replaceChildren();
      },
    };
  }

  const { profileId, itemId } = readSubscriptionAccountQuery(search, hash);
  return mountCustomerIframe(rootEl, {
    page: { pageId, profileId, itemId },
    getAuthToken: typeof options.getAuthToken === 'function'
      ? options.getAuthToken
      : getShopperAuthToken,
    onUnauthenticated: options.onUnauthenticated,
  });
}
