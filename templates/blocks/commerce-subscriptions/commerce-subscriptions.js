import { getShopperAuthToken } from '@dropins/storefront-recurbuy/api.js';
import { resolveSubscriptionAccountPageId } from '@dropins/storefront-recurbuy/account/subscription-routes.js';
import { render as RecurBuy } from '@dropins/storefront-recurbuy/render.js';
import SubscriptionAccountPage from '@dropins/storefront-recurbuy/containers/SubscriptionAccountPage.js';
import SubscriptionsList from '@dropins/storefront-recurbuy/containers/SubscriptionsList.js';
import {
  CUSTOMER_LOGIN_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';

/**
 * My Subscriptions — list + detail/edit on ONE published DA page.
 *
 * List:   /customer/subscriptions
 * Detail: /customer/subscriptions#rb/detail/91
 * Edit:   /customer/subscriptions#rb/edit-plan/91
 *
 * Hash routing avoids extra DA docs and keeps the same document for Adobe config.
 * Both containers mount the panel customer iframe; in-iframe navigation stays there.
 */
export default async function decorate(block) {
  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
    return;
  }

  const root = block.querySelector('[data-recurbuy-subscriptions-root]')
    || block.querySelector('[data-recurbuy-account-root]')
    || block;

  /** @type {{ destroy?: () => void }|null} */
  let active = null;

  const mount = () => {
    try {
      active?.destroy?.();
      active = null;

      const pageId = resolveSubscriptionAccountPageId(
        window.location.pathname,
        window.location.search,
        window.location.hash,
      );

      const onUnauthenticated = () => {
        window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
      };

      if (pageId) {
        active = RecurBuy.render(SubscriptionAccountPage, {
          page: pageId,
          getAuthToken: getShopperAuthToken,
          onUnauthenticated,
        })(root);
        return;
      }

      active = RecurBuy.render(SubscriptionsList, {
        getAuthToken: getShopperAuthToken,
        onUnauthenticated,
      })(root);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Subscriptions UI failed to load';
      root.innerHTML = `<div class="message error"><span>${message}</span></div>`;
      // eslint-disable-next-line no-console
      console.error('[RecurBuy] commerce-subscriptions decorate failed', error);
    }
  };

  mount();
  window.addEventListener('hashchange', mount);
}
