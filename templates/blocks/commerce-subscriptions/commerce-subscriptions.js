import { getShopperAuthToken } from '@dropins/storefront-recurbuy/api.js';
import { render as RecurBuy } from '@dropins/storefront-recurbuy/render.js';
import SubscriptionsList from '@dropins/storefront-recurbuy/containers/SubscriptionsList.js';
import {
  CUSTOMER_LOGIN_PATH,
  CUSTOMER_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';

/**
 * My Subscriptions — thin EDS glue around RecurBuy SubscriptionsList container.
 */
export default async function decorate(block) {
  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
    return;
  }

  const root = block.querySelector('[data-recurbuy-subscriptions-root]') || block;
  RecurBuy.render(SubscriptionsList, {
    getAuthToken: getShopperAuthToken,
    onUnauthenticated: () => {
      window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
    },
    getProfileHref: (row) => rootLink(
      `${CUSTOMER_PATH}/subscriptions/detail?profile_id=${encodeURIComponent(row.profile_id)}`,
    ),
  })(root);
}
