/**
 * My Subscriptions table — Adobe container shape (`mount` for render provider).
 */

import { mountSubscriptionsList } from '../src/mount-subscriptions-list.js';

const SubscriptionsList = {
  /**
   * @param {HTMLElement} el
   * @param {Parameters<typeof mountSubscriptionsList>[1]} [props]
   * @returns {ReturnType<typeof mountSubscriptionsList>}
   */
  mount(el, props = {}) {
    return mountSubscriptionsList(el, props);
  },
};

export default SubscriptionsList;
