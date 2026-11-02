/**
 * Shopper subscription detail / edit scaffolds — Adobe container shape.
 */

import { mountSubscriptionAccountPage } from '../src/mount-subscription-account-page.js';

const SubscriptionAccountPage = {
  /**
   * @param {HTMLElement} el
   * @param {Parameters<typeof mountSubscriptionAccountPage>[1]} [props]
   * @returns {ReturnType<typeof mountSubscriptionAccountPage>}
   */
  mount(el, props = {}) {
    return mountSubscriptionAccountPage(el, props);
  },
};

export default SubscriptionAccountPage;
