import { subscriptionAccountHref } from './account/subscription-routes.js';
import { renderAccountSuccessMessage } from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import { renderVaultCreditCardHtml } from './helpers/vault-credit-card-html.js';
import { formatProfileStatusLabel } from './subscriptions-list-format.js';

/**
 * @typedef {object} StorefrontProfileDetail
 * @property {number} profile_id
 * @property {string} [increment_id]
 * @property {string} [status]
 * @property {string} [plan_name]
 * @property {string|null} [currency_code]
 * @property {boolean} [is_virtual]
 * @property {Array<object>} [items]
 * @property {string|null} [shipping_address_html]
 * @property {{
 *   html?: string|null,
 *   payment_method_title?: string|null,
 *   payment_method?: string|null,
 *   payment_token_id?: number|null,
 *   payment_public_hash?: string|null,
 *   label?: string|null,
 *   details?: Record<string, unknown>|null,
 * }} [payment_details]
 * @property {Record<string, any>} [details]
 * @property {Record<string, any>} [actions]
 */

export const DETAIL_LABELS = {
  back: 'Back to My Subscriptions',
  title: 'Subscription',
  loading: 'Loading subscription…',
  error: 'Unable to load this subscription.',
  missingProfile: 'Missing profile. Open a subscription from My Subscriptions.',
  products: 'Product(s)',
  plan: 'Subscription Plan',
  nextPaymentDate: 'Next Payment Date',
  startDate: 'Subscription Start Date',
  shippingAddress: 'Shipping Address',
  paymentDetails: 'Payment Details',
  edit: 'Edit',
  extend: 'Extend Subscription',
  cancel: 'Cancel Subscription',
  skipThisDate: 'Skip This Date',
  starting: 'Starting',
  invalidToken: 'Please update payment details.',
  extendConfirm: 'Are you sure you want to extend this subscription?',
  cancelConfirm: 'Are you sure you want to cancel this subscription?',
  removeConfirm: 'Are you sure you want to remove product from this subscription?',
};

/**
 * @param {typeof DETAIL_LABELS} labels
 * @returns {string}
 */
export function renderDetailSkeleton(labels) {
  return `<div
  class="recurbuy-subscription-detail__skeleton"
  role="status"
  aria-live="polite"
  aria-busy="true"
  aria-label="${escapeHtml(labels.loading)}"
>
  <div class="dropin-skeleton" aria-hidden="true">
    <div class="dropin-skeleton-row dropin-skeleton-row__row-xlarge" style="max-width:40%"></div>
    <div class="dropin-skeleton-row dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"></div>
    <div class="dropin-skeleton-row dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"></div>
    <div class="dropin-skeleton-row dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"></div>
  </div>
</div>`;
}

/**
 * Magento `customer/subscriptions/edit/view.phtml` layout.
 *
 * @param {StorefrontProfileDetail} profile
 * @param {{
 *   labels?: Partial<typeof DETAIL_LABELS>,
 *   rootLink?: (path: string) => string,
 *   successMessage?: string|null,
 * }} [options]
 * @returns {string}
 */
export function renderSubscriptionDetail(profile, options = {}) {
  const labels = { ...DETAIL_LABELS, ...(options.labels || {}) };
  const { rootLink } = options;
  const successBanner = renderAccountSuccessMessage(options.successMessage || '');
  const profileId = Number(profile.profile_id);
  const actions = profile.actions && typeof profile.actions === 'object' ? profile.actions : {};
  const details = profile.details && typeof profile.details === 'object' ? profile.details : {};
  const statusCode = String(profile.status || '').toLowerCase();
  const statusLabel = formatProfileStatusLabel(profile.status);
  const increment = profile.increment_id || String(profileId);

  const topActions = [];
  if (actions.is_extend_available) {
    topActions.push(`
<button type="button" class="action primary" data-recurbuy-detail-action="extend">
  <span>${escapeHtml(labels.extend)}</span>
</button>`);
  }

  return `
<div class="recurbuy-subscription-detail__shell">
  <nav class="recurbuy-subscription-detail__nav">
    <a class="action back recurbuy-subscription-detail__back" href="${escapeHtml(subscriptionAccountHref('list', { rootLink }))}">${escapeHtml(labels.back)}</a>
  </nav>
  ${successBanner}
  <section class="dropin-card dropin-card--secondary recurbuy-subscription-detail__card" aria-labelledby="recurbuy-subscription-detail-title">
    <header class="recurbuy-subscription-detail__header">
      <div class="recurbuy-subscription-detail__heading">
        <p class="recurbuy-subscription-detail__eyebrow">${escapeHtml(labels.title)}</p>
        <h1 id="recurbuy-subscription-detail-title" class="recurbuy-subscription-detail__title">
          <span class="profile-id-badge">${escapeHtml(increment)}</span>
        </h1>
        <p class="recurbuy-subscription-detail__meta">
          <span class="status-badge status-${escapeHtml(statusCode)}">
            <span class="status-icon status-${escapeHtml(statusCode)}" aria-hidden="true"></span>
            <span class="status-label">${escapeHtml(statusLabel)}</span>
          </span>
        </p>
      </div>
      ${topActions.length ? `<div class="aw-sarp2__actions recurbuy-subscription-detail__top-actions">${topActions.join('')}</div>` : ''}
    </header>
    <div class="table-wrapper aw-sarp2-customer-subscriptions recurbuy-subscription-detail__table">
      <table class="data table">
        <tbody>
          ${renderProductsRow(profile, actions, labels, rootLink)}
          ${renderPlanRow(profile, actions, labels, rootLink)}
          ${renderRegularRow(details, labels)}
          ${renderNextPaymentRow(details, actions, labels, rootLink, profileId)}
          ${renderSimpleRow(labels.startDate, details.created_date)}
          ${renderSubscriptionEndRow(details, actions, labels)}
          ${renderInitialRow(details)}
          ${renderTrialRow(details, labels)}
          ${renderDeliveryRow(details)}
          ${renderShippingRow(profile, actions, labels, rootLink)}
          ${renderPaymentRow(profile, actions, labels, rootLink)}
        </tbody>
      </table>
    </div>
  </section>
</div>`;
}

/**
 * @param {StorefrontProfileDetail} profile
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 * @param {(path: string) => string} [rootLink]
 */
function renderProductsRow(profile, actions, labels, rootLink) {
  const items = Array.isArray(profile.items) ? profile.items : [];
  const parents = items.filter((item) => item && item.parent_item_id == null);
  const itemFlags = Array.isArray(actions.items) ? actions.items : [];
  const flagById = new Map(
    itemFlags.map((row) => [Number(row.item_id), row]),
  );

  const names = parents.length
    ? `<ul>${parents.map((item) => {
      const skipped = Boolean(flagById.get(Number(item.item_id))?.is_skip);
      const name = escapeHtml(String(item.name || ''));
      return `<li${skipped ? ' class="is-skipped"' : ''}><span>${name}</span>${skipped ? ' <em>(skipped)</em>' : ''}</li>`;
    }).join('')}</ul>`
    : '<span class="cell-empty" aria-hidden="true">—</span>';

  const actionLists = parents.map((item) => {
    const itemId = Number(item.item_id);
    const flags = flagById.get(itemId) || {};
    const parts = [];
    if (flags.is_edit_item_available) {
      parts.push(`<a class="action edit" href="${escapeHtml(subscriptionAccountHref('edit-item', {
        profileId: profile.profile_id,
        itemId,
        rootLink,
      }))}"><span>${escapeHtml(labels.edit)}</span></a>`);
    }
    if (flags.is_skip_available) {
      parts.push(`<a href="#" class="action skip-button" data-recurbuy-detail-action="skip-item" data-item-id="${itemId}"><span>${escapeHtml(flags.skip_label || 'Skip')}</span></a>`);
    }
    if (flags.is_unskip_available) {
      parts.push(`<a href="#" class="action unskip-button" data-recurbuy-detail-action="unskip-item" data-item-id="${itemId}"><span>${escapeHtml(flags.unskip_label || 'Unskip')}</span></a>`);
    }
    if (flags.is_remove_available) {
      parts.push(`<a href="#" class="action remove" data-recurbuy-detail-action="remove-item" data-item-id="${itemId}"><span>${escapeHtml(flags.remove_label || 'Remove From Subscription')}</span></a>`);
    }
    return `<li class="actions">${parts.join(' ') || '<br />'}</li>`;
  }).join('');

  return `
<tr>
  <th scope="row">${escapeHtml(labels.products)}</th>
  <td class="col products">${names}</td>
  <td class="col products actions"><ul>${actionLists}</ul></td>
</tr>`;
}

/**
 * @param {StorefrontProfileDetail} profile
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 * @param {(path: string) => string} [rootLink]
 */
function renderPlanRow(profile, actions, labels, rootLink) {
  const edit = actions.is_edit_plan_available
    ? `<a class="action aw-sarp2__subscription-plan" href="${escapeHtml(subscriptionAccountHref('edit-plan', {
      profileId: profile.profile_id,
      rootLink,
    }))}"><span>${escapeHtml(labels.edit)}</span></a>`
    : '';
  return `
<tr>
  <th scope="row">${escapeHtml(labels.plan)}</th>
  <td>${escapeHtml(profile.plan_name || '')}</td>
  <td class="col actions">${edit}</td>
</tr>`;
}

/**
 * @param {Record<string, any>} details
 * @param {typeof DETAIL_LABELS} labels
 */
function renderRegularRow(details, labels) {
  if (!details.is_show_regular) return '';
  const starting = details.is_trial_period_active && details.regular_start_date
    ? `<div class="started"><span class="label">${escapeHtml(labels.starting)}</span> <span class="date">${escapeHtml(details.regular_start_date)}</span></div>`
    : '';
  return `
<tr>
  <th scope="row">${escapeHtml(details.regular_label || '')}</th>
  <td>${escapeHtml(details.regular_price_and_cycles || '')}</td>
  <td>${starting}</td>
</tr>`;
}

/**
 * @param {Record<string, any>} details
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 * @param {(path: string) => string} [rootLink]
 * @param {number} profileId
 */
function renderNextPaymentRow(details, actions, labels, rootLink, profileId) {
  const parts = [];
  if (actions.is_edit_next_payment_date_available) {
    parts.push(`<a class="action aw-sarp2__next-payment-date" href="${escapeHtml(subscriptionAccountHref('edit-next-payment-date', {
      profileId,
      rootLink,
    }))}"><span>${escapeHtml(labels.edit)}</span></a>`);
  }
  if (actions.is_skip_this_date_available) {
    parts.push(`<a href="#" class="action aw-sarp2__skip-this-date" data-recurbuy-detail-action="skip-next"><span>${escapeHtml(labels.skipThisDate)}</span></a>`);
  }
  return `
<tr>
  <th scope="row">${escapeHtml(labels.nextPaymentDate)}</th>
  <td>${escapeHtml(details.next_payment_info || '')}</td>
  <td class="col actions">${parts.join(' ')}</td>
</tr>`;
}

/**
 * @param {string} label
 * @param {string|null|undefined} value
 * @param {string} [actionsHtml]
 */
function renderSimpleRow(label, value, actionsHtml = '') {
  return `
<tr>
  <th scope="row">${escapeHtml(label)}</th>
  <td>${value ? escapeHtml(String(value)) : '<span class="cell-empty" aria-hidden="true">—</span>'}</td>
  <td class="col actions">${actionsHtml}</td>
</tr>`;
}

/**
 * @param {Record<string, any>} details
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 */
function renderSubscriptionEndRow(details, actions, labels) {
  const cancel = actions.is_cancel_available
    ? `<a href="#" class="action" data-recurbuy-detail-action="cancel"><span>${escapeHtml(labels.cancel)}</span></a>`
    : '';
  return renderSimpleRow(
    details.subscription_end_label || 'Subscription Ends',
    details.subscription_end_date,
    cancel,
  );
}

/**
 * @param {Record<string, any>} details
 */
function renderInitialRow(details) {
  if (!details.is_show_initial) return '';
  return `
<tr>
  <th scope="row">${escapeHtml(details.initial_label || '')}</th>
  <td>${escapeHtml(details.initial_price || '')}</td>
  <td>${escapeHtml(details.initial_start_date || '')}</td>
</tr>`;
}

/**
 * @param {Record<string, any>} details
 * @param {typeof DETAIL_LABELS} labels
 */
function renderTrialRow(details, labels) {
  if (!details.is_show_trial) return '';
  const starting = details.trial_start_date
    ? `<div class="started"><span class="label">${escapeHtml(labels.starting)}</span> <span class="date">${escapeHtml(details.trial_start_date)}</span></div>`
    : '';
  return `
<tr>
  <th scope="row">${escapeHtml(details.trial_label || '')}</th>
  <td>${escapeHtml(details.trial_price_and_cycles || '')}</td>
  <td>${starting}</td>
</tr>`;
}

/**
 * @param {Record<string, any>} details
 */
function renderDeliveryRow(details) {
  if (details.next_delivery_info == null) return '';
  return renderSimpleRow('Next Delivery Date', details.next_delivery_info);
}

/**
 * @param {StorefrontProfileDetail} profile
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 * @param {(path: string) => string} [rootLink]
 */
function renderShippingRow(profile, actions, labels, rootLink) {
  if (profile.is_virtual || !profile.shipping_address_html) return '';
  const edit = actions.is_edit_address_available
    ? `<a class="action aw-sarp2__shipping-address" href="${escapeHtml(subscriptionAccountHref('edit-address', {
      profileId: profile.profile_id,
      rootLink,
    }))}"><span>${escapeHtml(labels.edit)}</span></a>`
    : '';
  return `
<tr>
  <th scope="row">${escapeHtml(labels.shippingAddress)}</th>
  <td class="col address">${profile.shipping_address_html}</td>
  <td class="col actions">${edit}</td>
</tr>`;
}

/**
 * @param {StorefrontProfileDetail} profile
 * @param {Record<string, any>} actions
 * @param {typeof DETAIL_LABELS} labels
 * @param {(path: string) => string} [rootLink]
 */
function renderPaymentRow(profile, actions, labels, rootLink) {
  const payment = profile.payment_details && typeof profile.payment_details === 'object'
    ? profile.payment_details
    : {};
  const tip = actions.is_show_invalid_token_tooltip
    ? `<span class="payment-token-fail" title="${escapeHtml(labels.invalidToken)}"></span>`
    : '';
  const body = paymentMethodBodyHtml(payment);
  const edit = actions.is_edit_payment_available
    ? `<a class="action aw-sarp2__payment-details" href="${escapeHtml(subscriptionAccountHref('edit-payment', {
      profileId: profile.profile_id,
      rootLink,
    }))}"><span>${escapeHtml(labels.edit)}</span></a>`
    : '';
  return `
<tr>
  <th scope="row">${escapeHtml(labels.paymentDetails)} ${tip}</th>
  <td class="col payment">${body}</td>
  <td class="col actions">${edit}</td>
</tr>`;
}

/**
 * Prefer server vault HTML, else AccS credit-card markup from details, else a safe text label.
 *
 * @param {{
 *   html?: string|null,
 *   payment_method_title?: string|null,
 *   payment_method?: string|null,
 *   payment_token_id?: number|null,
 *   payment_public_hash?: string|null,
 *   label?: string|null,
 *   details?: Record<string, unknown>|null,
 * }} payment
 * @returns {string}
 */
function paymentMethodBodyHtml(payment) {
  const vaultHtml = renderVaultCreditCardHtml(payment.details);
  if (vaultHtml) {
    return vaultHtml;
  }
  if (typeof payment.html === 'string' && payment.html.trim() !== '') {
    return payment.html.replace(
      /<div class="card-type">\s*<span>\s*(?:UNKNOWN|OT|UN)\s*<\/span>\s*<\/div>/gi,
      '',
    );
  }
  return `<span class="recurbuy-subscription-detail__payment-label">${escapeHtml(formatPaymentMethodLabel(payment))}</span>`;
}

/**
 * Avoid dumping raw Adobe payment codes into the shopper UI.
 *
 * @param {{
 *   payment_method_title?: string|null,
 *   payment_method?: string|null,
 *   payment_token_id?: number|null,
 *   payment_public_hash?: string|null,
 *   label?: string|null,
 *   details?: Record<string, unknown>|null,
 * }} payment
 * @returns {string}
 */
function formatPaymentMethodLabel(payment) {
  if (typeof payment.label === 'string' && payment.label.trim() !== '') {
    return payment.label.trim();
  }
  const details = payment.details && typeof payment.details === 'object' ? payment.details : null;
  const maskedCc = details ? String(details.maskedCC ?? '').trim() : '';
  if (maskedCc !== '') {
    return `•••• ${maskedCc}`;
  }

  const title = String(payment.payment_method_title || payment.payment_method || '').trim();
  const hasVault = Boolean(payment.payment_token_id)
    || (typeof payment.payment_public_hash === 'string' && payment.payment_public_hash !== '');
  if (!title) {
    return hasVault ? 'Saved payment method' : '—';
  }
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(title)) {
    if (hasVault) return 'Saved payment method';
    return title
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return title;
}
