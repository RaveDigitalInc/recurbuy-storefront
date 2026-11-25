import {
  readSubscriptionAccountQuery,
  resolveSubscriptionAccountPageId,
} from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { mountCustomerIframe } from './customer-iframe-host.js';

/**
 * Customer account "My Subscriptions" — panel customer iframe.
 * Also honors `#rb/<pageId>/<profileId>` deep links even when the host block
 * template only mounts `SubscriptionsList`.
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

  let page = 'list';
  if (typeof window !== 'undefined') {
    const pageId = resolveSubscriptionAccountPageId(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    if (pageId) {
      const { profileId, itemId } = readSubscriptionAccountQuery(
        window.location.search,
        window.location.hash,
      );
      page = { pageId, profileId, itemId };
    }
  }

  return mountCustomerIframe(rootEl, {
    page,
    getAuthToken: typeof options.getAuthToken === 'function'
      ? options.getAuthToken
      : getShopperAuthToken,
    onUnauthenticated: options.onUnauthenticated,
  });
}
