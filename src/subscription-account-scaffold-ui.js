import { escapeHtml } from './helpers/dom-html.js';
import {
  getSubscriptionAccountPage,
  subscriptionAccountHref,
} from './account/subscription-routes.js';

/**
 * @typedef {import('./account/subscription-routes.js').SubscriptionAccountPageId} PageId
 */

/**
 * @param {{
 *   pageId: PageId,
 *   profileId: string|null,
 *   itemId: string|null,
 *   rootLink?: (path: string) => string,
 * }} input
 * @returns {string}
 */
export function renderSubscriptionAccountScaffold(input) {
  const page = getSubscriptionAccountPage(input.pageId);
  const title = page?.title || 'Subscription';
  const profileLabel = input.profileId
    ? `Profile #${input.profileId}`
    : 'No profile selected';

  if (!input.profileId) {
    return `
<nav class="recurbuy-account-scaffold__nav">
  <a class="action back" href="${escapeHtml(subscriptionAccountHref('list', { rootLink: input.rootLink }))}">Back to My Subscriptions</a>
</nav>
<div class="message info empty">
  <span>Missing profile_id. Open a subscription from My Subscriptions.</span>
</div>`;
  }

  if (input.pageId === 'detail') {
    return renderDetailScaffold(input, title, profileLabel);
  }

  return renderEditScaffold(input, title, profileLabel);
}

/**
 * @param {{
 *   pageId: PageId,
 *   profileId: string|null,
 *   itemId: string|null,
 *   rootLink?: (path: string) => string,
 * }} input
 * @param {string} title
 * @param {string} profileLabel
 * @returns {string}
 */
function renderDetailScaffold(input, title, profileLabel) {
  const { profileId, rootLink } = input;
  const rows = [
    {
      label: 'Product(s)',
      value: '— (scaffold)',
      href: subscriptionAccountHref('edit-item', { profileId, itemId: '1', rootLink }),
      editLabel: 'Edit item',
    },
    {
      label: 'Subscription Plan',
      value: '— (scaffold)',
      href: subscriptionAccountHref('edit-plan', { profileId, rootLink }),
    },
    {
      label: 'Next Payment Date',
      value: '— (scaffold)',
      href: subscriptionAccountHref('edit-next-payment-date', { profileId, rootLink }),
    },
    {
      label: 'Shipping Address',
      value: '— (scaffold)',
      href: subscriptionAccountHref('edit-address', { profileId, rootLink }),
    },
    {
      label: 'Payment Details',
      value: '— (scaffold)',
      href: subscriptionAccountHref('edit-payment', { profileId, rootLink }),
    },
  ];

  const body = rows.map((row) => `
<tr>
  <th scope="row">${escapeHtml(row.label)}</th>
  <td>${escapeHtml(row.value)}</td>
  <td class="col actions">
    <a class="action edit" href="${escapeHtml(row.href)}">
      <span>${escapeHtml(row.editLabel || 'Edit')}</span>
    </a>
  </td>
</tr>`).join('');

  return `
<nav class="recurbuy-account-scaffold__nav">
  <a class="action back" href="${escapeHtml(subscriptionAccountHref('list', { rootLink }))}">Back to My Subscriptions</a>
</nav>
<header class="recurbuy-account-scaffold__header">
  <h1 class="recurbuy-account-scaffold__title">${escapeHtml(title)}</h1>
  <p class="recurbuy-account-scaffold__meta">${escapeHtml(profileLabel)}</p>
  <p class="recurbuy-account-scaffold__note">Scaffold page — wire RecurBuy profile API later. Links below match Magento SARP edit screens.</p>
</header>
<div class="table-wrapper aw-sarp2-customer-subscriptions recurbuy-account-scaffold__table">
  <table class="data table">
    <tbody>${body}</tbody>
  </table>
</div>`;
}

/**
 * @param {{
 *   pageId: PageId,
 *   profileId: string|null,
 *   itemId: string|null,
 *   rootLink?: (path: string) => string,
 * }} input
 * @param {string} title
 * @param {string} profileLabel
 * @returns {string}
 */
function renderEditScaffold(input, title, profileLabel) {
  const {
    pageId,
    profileId,
    itemId,
    rootLink,
  } = input;
  const backHref = subscriptionAccountHref('detail', { profileId, rootLink });
  let itemHint = '';
  if (pageId === 'edit-item' && itemId) {
    itemHint = ` · Item #${itemId}`;
  } else if (pageId === 'edit-item') {
    itemHint = ' · pick an item from the detail page';
  }

  return `
<nav class="recurbuy-account-scaffold__nav">
  <a class="action back" href="${escapeHtml(backHref)}">Back to Subscription</a>
</nav>
<header class="recurbuy-account-scaffold__header">
  <h1 class="recurbuy-account-scaffold__title">${escapeHtml(title)}</h1>
  <p class="recurbuy-account-scaffold__meta">${escapeHtml(profileLabel)}${escapeHtml(itemHint)}</p>
  <p class="recurbuy-account-scaffold__note">Scaffold form — save actions will call RecurBuy later.</p>
</header>
<form class="recurbuy-account-scaffold__form" data-recurbuy-scaffold-form="${escapeHtml(pageId)}">
  <div class="field">
    <label for="recurbuy-scaffold-field">${escapeHtml(title)}</label>
    <textarea
      id="recurbuy-scaffold-field"
      name="scaffold_value"
      rows="4"
      placeholder="Editable placeholder — not persisted yet"
    ></textarea>
  </div>
  <div class="actions-toolbar">
    <button type="submit" class="action primary" disabled title="Not wired yet">
      <span>Save (coming soon)</span>
    </button>
    <a class="action secondary" href="${escapeHtml(backHref)}"><span>Cancel</span></a>
  </div>
</form>`;
}
