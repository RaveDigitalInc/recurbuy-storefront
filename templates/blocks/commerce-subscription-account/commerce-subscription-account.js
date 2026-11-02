import { render as RecurBuy } from '@dropins/storefront-recurbuy/render.js';
import SubscriptionAccountPage from '@dropins/storefront-recurbuy/containers/SubscriptionAccountPage.js';
import {
  CUSTOMER_LOGIN_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';

/**
 * Subscription detail / edit scaffolds — Magento SARP profile_edit* parity stubs.
 * Page kind is resolved from the URL path under /customer/subscriptions/*.
 */
export default async function decorate(block) {
  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
    return;
  }

  const root = block.querySelector('[data-recurbuy-account-root]') || block;
  RecurBuy.render(SubscriptionAccountPage, {
    rootLink,
  })(root);
}
