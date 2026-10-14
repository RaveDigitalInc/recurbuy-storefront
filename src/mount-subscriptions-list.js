import {
  extendShopperProfile,
  fetchShopperProfileDetail,
  fetchShopperProfilesList,
  persistShowCanceledSubscriptions,
  renewShopperProfile,
} from './adapters/storefront-profiles-list-adapter.js';
import { getShopperAuthToken } from './auth.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
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

const DEFAULT_LABELS = {
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
 * Escape text for HTML text nodes / attributes.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Magento customer account "My Subscriptions" table for EDS.
 * Mirrors `module-sarp3` `aw_sarp3/profile` list (phtml + options + pager).
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   getProfileHref?: (row: object) => string,
 *   labels?: Partial<typeof DEFAULT_LABELS>,
 *   perPage?: number,
 *   loadRowActions?: boolean,
 * }} [options]
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionsList(rootEl, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionsList requires a DOM element.');
  }

  ensureRecurBuyStyles();

  const labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;
  const perPage = Number(options.perPage) > 0 ? Number(options.perPage) : 10;
  const loadRowActions = options.loadRowActions !== false;
  const getProfileHref = typeof options.getProfileHref === 'function'
    ? options.getProfileHref
    : (row) => `/customer/subscriptions/detail?profile_id=${row.profile_id}`;

  /** @type {{ page: number, showCanceled: boolean|null, busy: boolean, destroyed: boolean }} */
  const state = {
    page: 1,
    showCanceled: null,
    busy: false,
    destroyed: false,
  };

  rootEl.classList.add('recurbuy-subscriptions-list');
  rootEl.innerHTML = renderSkeleton();

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-subscriptions-list');
    },
    async refresh() {
      await loadAndRender();
    },
  };

  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('click', onClick);

  const originalDestroy = api.destroy;
  api.destroy = () => {
    rootEl.removeEventListener('change', onChange);
    rootEl.removeEventListener('click', onClick);
    originalDestroy();
  };

  loadAndRender();
  return api;

  /**
   * @param {Event} event
   */
  function onChange(event) {
    const { target } = event;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== 'are_show_canceled_subscriptions') return;
    onToggleCanceled(target.checked);
  }

  /**
   * @param {MouseEvent} event
   */
  function onClick(event) {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-recurbuy-action]');
    if (!(button instanceof HTMLElement)) return;
    event.preventDefault();
    const action = button.getAttribute('data-recurbuy-action');
    const profileId = Number(button.getAttribute('data-profile-id'));
    if (!profileId) return;
    if (action === 'page') {
      const page = Number(button.getAttribute('data-page'));
      if (page > 0) {
        state.page = page;
        loadAndRender();
      }
      return;
    }
    if (action === 'renew') {
      onRenew(profileId);
      return;
    }
    if (action === 'extend') {
      onExtend(profileId);
    }
  }

  /**
   * @param {boolean} checked
   */
  async function onToggleCanceled(checked) {
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }
    state.showCanceled = checked;
    state.page = 1;
    try {
      await persistShowCanceledSubscriptions({ authToken, value: checked });
    } catch {
      // Still refetch with query override so UI matches checkbox.
    }
    await loadAndRender();
  }

  /**
   * @param {number} profileId
   */
  async function onRenew(profileId) {
    if (!window.confirm(labels.resumeConfirm)) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }
    try {
      await renewShopperProfile({ authToken, profileId });
      await loadAndRender();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : labels.error);
    }
  }

  /**
   * @param {number} profileId
   */
  async function onExtend(profileId) {
    if (!window.confirm(labels.extendConfirm)) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }
    try {
      await extendShopperProfile({ authToken, profileId });
      await loadAndRender();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : labels.error);
    }
  }

  async function loadAndRender() {
    if (state.destroyed || state.busy) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(labels.error)}</span></div>`;
      return;
    }

    state.busy = true;
    rootEl.innerHTML = renderSkeleton();

    try {
      const result = await fetchShopperProfilesList({
        authToken,
        page: state.page,
        perPage,
        showCanceled: state.showCanceled,
      });
      if (state.destroyed) return;

      state.showCanceled = Boolean(result.meta.are_show_canceled_subscriptions);
      /** @type {ProfileRow[]} */
      let rows = result.data;

      if (loadRowActions && rows.length > 0) {
        rows = await enrichRowsWithActions(authToken, rows);
      }
      if (state.destroyed) return;

      rootEl.innerHTML = renderList(rows, result.meta);
    } catch (error) {
      if (state.destroyed) return;
      if (error?.status === 401) {
        options.onUnauthenticated?.();
      }
      const message = error instanceof Error && error.message ? error.message : labels.error;
      rootEl.innerHTML = `<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }

  /**
   * @param {string} authToken
   * @param {ProfileRow[]} rows
   */
  async function enrichRowsWithActions(authToken, rows) {
    const details = await Promise.allSettled(
      rows.map((row) => fetchShopperProfileDetail({ authToken, profileId: row.profile_id })),
    );
    return rows.map((row, index) => {
      const settled = details[index];
      if (settled.status !== 'fulfilled') {
        return { ...row, actions: { is_edit_available: true } };
      }
      const actions = settled.value?.data?.actions && typeof settled.value.data.actions === 'object'
        ? settled.value.data.actions
        : {};
      return {
        ...row,
        actions: {
          is_edit_available: true,
          is_renew_available: Boolean(actions.is_renew_available),
          is_extend_available: Boolean(actions.is_extend_available),
          is_show_invalid_token_tooltip: Boolean(actions.is_show_invalid_token_tooltip),
        },
        currency_code: settled.value?.data?.currency_code || row.currency_code,
      };
    });
  }

  /**
   * Card + shimmer rows — mirrors storefront-account OrdersList loading
   * (`orderSkeletonLoader` / `account-account-loaders--card-loader`).
   *
   * @param {number} [count]
   * @returns {string}
   */
  function renderSkeleton(count = 3) {
    const cards = Array.from({ length: count }, () => `
<div class="dropin-card dropin-card--secondary account-account-loaders account-account-loaders--card-loader" data-testid="subscriptionSkeletonLoader">
  <div class="dropin-card__content">
    <div class="dropin-skeleton" aria-hidden="true">
      <div class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge" style="max-width:40%"></div>
      <div class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"></div>
      <div class="dropin-skeleton-row dropin-skeleton--row__content dropin-skeleton-row__row-xlarge dropin-skeleton-row--full"></div>
    </div>
  </div>
</div>`).join('');

    return `<div class="recurbuy-subscriptions-list__skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(labels.loading)}">${cards}</div>`;
  }

  /**
   * @param {ProfileRow[]} rows
   * @param {ProfileListMeta} meta
   */
  function renderList(rows, meta) {
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

    const body = rows.map((row) => renderRow(row)).join('');
    const pager = renderPager(meta);

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
   */
  function renderRow(row) {
    const statusCode = String(row.status || '').toLowerCase();
    const statusLabel = formatProfileStatusLabel(row.status);
    const products = Array.isArray(row.products) ? row.products : [];
    const productsHtml = products.length
      ? `<ul>${products.map((product) => `<li><span>${escapeHtml(product.name)}</span></li>`).join('')}</ul>`
      : '';
    const actions = row.actions && typeof row.actions === 'object' ? row.actions : { is_edit_available: true };
    const href = escapeHtml(getProfileHref(row));
    const actionParts = [];
    if (actions.is_edit_available !== false) {
      actionParts.push(`<a href="${href}" class="action edit"><span>${escapeHtml(labels.edit)}</span></a>`);
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
   */
  function renderPager(meta) {
    if (meta.last_page <= 1) return '';
    const prevDisabled = meta.current_page <= 1 ? 'disabled' : '';
    const nextDisabled = meta.current_page >= meta.last_page ? 'disabled' : '';
    const pageLabel = labels.pageOf
      .replace('{current}', String(meta.current_page))
      .replace('{last}', String(meta.last_page));
    return `
<div class="toolbar bottom recurbuy-subscriptions-list__pager">
  <button type="button" class="action" data-recurbuy-action="page" data-page="${meta.current_page - 1}" ${prevDisabled}>${escapeHtml(labels.previous)}</button>
  <span class="recurbuy-subscriptions-list__pager-status">${escapeHtml(pageLabel)}</span>
  <button type="button" class="action" data-recurbuy-action="page" data-page="${meta.current_page + 1}" ${nextDisabled}>${escapeHtml(labels.next)}</button>
</div>`;
  }
}
