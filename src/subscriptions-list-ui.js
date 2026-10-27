import { escapeHtml } from './helpers/dom-html.js';
import {
  formatNextPaymentAmountInfo,
  formatNextPaymentDateInfo,
  formatProfileStatusLabel,
} from './subscriptions-list-format.js';

/**
 * @typedef {import('./adapters/storefront-profiles-list-adapter.js')
 *   .StorefrontProfileListRow} ProfileRow
 * @typedef {import('./adapters/storefront-profiles-list-adapter.js')
 *   .StorefrontProfileListResult['meta']} ProfileListMeta
 */

export const DEFAULT_LABELS = {
  empty: "You don't have subscriptions.",
  showCanceled: 'Show canceled subscriptions',
  caption: 'Subscriptions',
  profileId: 'Profile ID',
  status: 'Status',
  products: 'Product(s)',
  plan: 'Plan',
  trialEndDate: 'Trial End Date',
  lastPaymentDate: 'Last Payment Date',
  nextPaymentDate: 'Next Payment Date',
  nextPaymentAmount: 'Next Payment Amount',
  actions: 'Actions',
  edit: 'Edit',
  resume: 'Resume',
  extend: 'Extend',
  resumeConfirm: 'You are about to resume your subscription.\nContinue?',
  extendConfirm: 'Are you sure you want to extend this subscription?',
  invalidToken: 'Please update payment details.',
  loading: 'Loading subscriptions…',
  error: 'Unable to load subscriptions.',
  previous: 'Previous',
  next: 'Next',
  pageOf: 'Page {current} of {last}',
};

/**
 * Card + shimmer rows — mirrors storefront-account OrdersList loading.
 *
 * @param {typeof DEFAULT_LABELS} labels
 * @param {number} [count]
 * @returns {string}
 */
export function renderSkeleton(labels, count = 3) {
  const cards = Array.from({ length: count }, () => `
<div
  class="dropin-card dropin-card--secondary account-account-loaders account-account-loaders--card-loader"
  data-testid="subscriptionSkeletonLoader"
>
  <div class="dropin-card__content">
    <div class="dropin-skeleton" aria-hidden="true">
      <div
        class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge"
        style="max-width:40%"
      ></div>
      <div
        class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"
      ></div>
      <div
        class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"
      ></div>
    </div>
  </div>
</div>`).join('');

  return `<div
  class="recurbuy-subscriptions-list__skeleton"
  role="status"
  aria-live="polite"
  aria-busy="true"
  aria-label="${escapeHtml(labels.loading)}"
>${cards}</div>`;
}

/**
 * @param {ProfileRow[]} rows
 * @param {ProfileListMeta} meta
 * @param {typeof DEFAULT_LABELS} labels
 * @param {(row: ProfileRow) => string} getProfileHref
 * @returns {string}
 */
export function renderList(rows, meta, labels, getProfileHref) {
  const showCanceled = Boolean(meta.are_show_canceled_subscriptions);
  const optionsHtml = `
<section class="customer-subscriptions-options">
  <ul class="customer-subscriptions-options-list">
    <li class="customer-subscriptions-option">
      <input type="checkbox"
             name="are_show_canceled_subscriptions"
             id="are_show_canceled_subscriptions"
             ${showCanceled ? 'checked' : ''} />
      <label for="are_show_canceled_subscriptions">${escapeHtml(labels.showCanceled)}</label>
    </li>
  </ul>
</section>`;

  if (!rows.length) {
    return `${optionsHtml}
<div class="message info empty">
  <span>${escapeHtml(labels.empty)}</span>
</div>`;
  }

  const body = rows.map((row) => renderRow(row, labels, getProfileHref)).join('');
  const pager = renderPager(meta, labels);

  return `${optionsHtml}
<div class="table-wrapper aw-sarp2-customer-subscriptions">
  <table class="data table">
    <caption class="table-caption">${escapeHtml(labels.caption)}</caption>
    <thead>
      <tr>
        <th scope="col" class="col profile-id">${escapeHtml(labels.profileId)}</th>
        <th scope="col" class="col status">${escapeHtml(labels.status)}</th>
        <th scope="col" class="col products">${escapeHtml(labels.products)}</th>
        <th scope="col" class="col subscription-plan">${escapeHtml(labels.plan)}</th>
        <th scope="col" class="col trial-payment-due-date">${escapeHtml(labels.trialEndDate)}</th>
        <th scope="col" class="col next-payment-date">${escapeHtml(labels.lastPaymentDate)}</th>
        <th scope="col" class="col next-payment-date">${escapeHtml(labels.nextPaymentDate)}</th>
        <th scope="col" class="col next-payment-amount">${escapeHtml(labels.nextPaymentAmount)}</th>
        <th scope="col" class="col actions">${escapeHtml(labels.actions)}</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</div>
${pager}`;
}

/**
 * @param {ProfileRow} row
 * @param {typeof DEFAULT_LABELS} labels
 * @param {(row: ProfileRow) => string} getProfileHref
 * @returns {string}
 */
export function renderRow(row, labels, getProfileHref) {
  const statusCode = String(row.status || '').toLowerCase();
  const statusLabel = formatProfileStatusLabel(row.status);
  const products = Array.isArray(row.products) ? row.products : [];
  const productsHtml = products.length
    ? `<ul>${products.map((product) => `<li><span>${escapeHtml(product.name)}</span></li>`).join('')}</ul>`
    : '';
  const actions = row.actions && typeof row.actions === 'object'
    ? row.actions
    : { is_edit_available: true };
  const href = escapeHtml(getProfileHref(row));
  const actionParts = [];
  if (actions.is_edit_available !== false) {
    actionParts.push(
      `<a href="${href}" class="action edit"><span>${escapeHtml(labels.edit)}</span></a>`,
    );
  }
  if (actions.is_renew_available) {
    actionParts.push(
      `<a href="#" class="action renew" data-recurbuy-action="renew" data-profile-id="${row.profile_id}"><span>${escapeHtml(labels.resume)}</span></a>`,
    );
  }
  if (actions.is_extend_available) {
    actionParts.push(
      `<a href="#" class="action extend" data-recurbuy-action="extend" data-profile-id="${row.profile_id}"><span>${escapeHtml(labels.extend)}</span></a>`,
    );
  }
  const tokenTip = actions.is_show_invalid_token_tooltip
    ? `<span class="payment-token-fail" title="${escapeHtml(labels.invalidToken)}"></span>`
    : '';

  const trial = row.trial_end_date
    ? escapeHtml(row.trial_end_date)
    : '<span class="cell-empty" aria-hidden="true">—</span>';
  const lastPayment = row.last_payment_date
    ? escapeHtml(row.last_payment_date)
    : '<span class="cell-empty" aria-hidden="true">—</span>';
  const nextPayment = formatNextPaymentDateInfo(row);
  const nextPaymentHtml = nextPayment
    ? escapeHtml(nextPayment)
    : '<span class="cell-empty" aria-hidden="true">—</span>';
  const amount = formatNextPaymentAmountInfo(row);
  const amountHtml = amount
    ? `<span class="amount">${escapeHtml(amount)}</span>`
    : '<span class="cell-empty" aria-hidden="true">—</span>';

  return `
<tr>
  <td data-th="${escapeHtml(labels.profileId)}" class="col profile-id"><span class="profile-id-badge">${escapeHtml(row.increment_id || row.profile_id)}</span></td>
  <td data-th="${escapeHtml(labels.status)}" class="col status">
    <span class="status-badge status-${escapeHtml(statusCode)}">
      <span class="status-icon status-${escapeHtml(statusCode)}" aria-hidden="true"></span>
      <span class="status-label">${escapeHtml(statusLabel)}</span>
      ${tokenTip}
    </span>
  </td>
  <td data-th="${escapeHtml(labels.products)}" class="col products">${productsHtml}</td>
  <td data-th="${escapeHtml(labels.plan)}" class="col subscription-plan">${escapeHtml(row.plan_name || '')}</td>
  <td data-th="${escapeHtml(labels.trialEndDate)}" class="col trial-due-date">${trial}</td>
  <td data-th="${escapeHtml(labels.lastPaymentDate)}" class="col last-payment-date">${lastPayment}</td>
  <td data-th="${escapeHtml(labels.nextPaymentDate)}" class="col next-payment-date">${nextPaymentHtml}</td>
  <td data-th="${escapeHtml(labels.nextPaymentAmount)}" class="col next-payment-amount">${amountHtml}</td>
  <td data-th="${escapeHtml(labels.actions)}" class="col actions">${actionParts.join(' ')}</td>
</tr>`;
}

/**
 * @param {ProfileListMeta} meta
 * @param {typeof DEFAULT_LABELS} labels
 * @returns {string}
 */
export function renderPager(meta, labels) {
  if (meta.last_page <= 1) return '';
  const prevDisabled = meta.current_page <= 1 ? 'disabled' : '';
  const nextDisabled = meta.current_page >= meta.last_page ? 'disabled' : '';
  const pageLabel = labels.pageOf
    .replace('{current}', String(meta.current_page))
    .replace('{last}', String(meta.last_page));
  return `
<div class="toolbar bottom recurbuy-subscriptions-list__pager">
  <button
    type="button"
    class="action"
    data-recurbuy-action="page"
    data-page="${meta.current_page - 1}"
    ${prevDisabled}
  >${escapeHtml(labels.previous)}</button>
  <span class="recurbuy-subscriptions-list__pager-status">${escapeHtml(pageLabel)}</span>
  <button
    type="button"
    class="action"
    data-recurbuy-action="page"
    data-page="${meta.current_page + 1}"
    ${nextDisabled}
  >${escapeHtml(labels.next)}</button>
</div>`;
}
