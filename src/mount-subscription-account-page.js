import {
  readSubscriptionAccountQuery,
  resolveSubscriptionAccountPageId,
} from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { mountSubscriptionDetail } from './mount-subscription-detail.js';
import { mountSubscriptionEditItem } from './mount-subscription-edit-item.js';
import { mountSubscriptionEditNextPaymentDate } from './mount-subscription-edit-next-payment-date.js';
import { mountSubscriptionEditPayment } from './mount-subscription-edit-payment.js';
import { mountSubscriptionEditPlan } from './mount-subscription-edit-plan.js';
import { renderSubscriptionAccountScaffold } from './subscription-account-scaffold-ui.js';

/**
 * Account subscription detail / edit pages.
 * `detail`, `edit-plan`, `edit-item`, `edit-next-payment-date`, and `edit-payment` are wired;
 * other edit pages stay scaffolds until ready.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   page?: import('./account/subscription-routes.js').SubscriptionAccountPageId,
 *   pathname?: string,
 *   search?: string,
 *   hash?: string,
 *   rootLink?: (path: string) => string,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 * }} [options]
 * @returns {{ destroy: () => void }}
 */
export function mountSubscriptionAccountPage(rootEl, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionAccountPage requires a DOM element.');
  }

  ensureRecurBuyStyles();

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
  const shared = {
    profileId,
    rootLink: options.rootLink,
    getAuthToken: options.getAuthToken || getShopperAuthToken,
    onUnauthenticated: options.onUnauthenticated,
  };

  if (pageId === 'detail') {
    return mountSubscriptionDetail(rootEl, shared);
  }

  if (pageId === 'edit-plan') {
    return mountSubscriptionEditPlan(rootEl, shared);
  }

  if (pageId === 'edit-item') {
    return mountSubscriptionEditItem(rootEl, {
      ...shared,
      itemId,
    });
  }

  if (pageId === 'edit-next-payment-date') {
    return mountSubscriptionEditNextPaymentDate(rootEl, shared);
  }

  if (pageId === 'edit-payment') {
    return mountSubscriptionEditPayment(rootEl, shared);
  }

  rootEl.classList.add('recurbuy-account-scaffold');
  rootEl.innerHTML = renderSubscriptionAccountScaffold({
    pageId,
    profileId,
    itemId,
    rootLink: options.rootLink,
  });

  return {
    destroy() {
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-account-scaffold');
    },
  };
}
