import {
  extendShopperProfile,
  fetchShopperProfileDetail,
  fetchShopperProfilesList,
  persistShowCanceledSubscriptions,
  renewShopperProfile,
} from './adapters/storefront-profiles-list-adapter.js';
import { getShopperAuthToken } from './auth.js';
import { escapeHtml } from './helpers/dom-html.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { confirmAction, showError } from './helpers/user-prompt.js';
import {
  DEFAULT_LABELS,
  renderList,
  renderSkeleton,
} from './subscriptions-list-ui.js';

/**
 * @typedef {import('./adapters/storefront-profiles-list-adapter.js')
 *   .StorefrontProfileListRow} ProfileRow
 */

/**
 * Customer account "My Subscriptions" table for EDS.
 * Mirrors shopper profile list (phtml + options + pager).
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
  rootEl.innerHTML = renderSkeleton(labels);

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
    if (!(await confirmAction(rootEl, labels.resumeConfirm))) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }
    try {
      await renewShopperProfile({ authToken, profileId });
      await loadAndRender();
    } catch (error) {
      showError(rootEl, error instanceof Error ? error.message : labels.error);
    }
  }

  /**
   * @param {number} profileId
   */
  async function onExtend(profileId) {
    if (!(await confirmAction(rootEl, labels.extendConfirm))) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }
    try {
      await extendShopperProfile({ authToken, profileId });
      await loadAndRender();
    } catch (error) {
      showError(rootEl, error instanceof Error ? error.message : labels.error);
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
    rootEl.innerHTML = renderSkeleton(labels);

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

      rootEl.innerHTML = renderList(rows, result.meta, labels, getProfileHref);
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
}
