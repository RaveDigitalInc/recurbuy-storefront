import {
  cancelShopperProfile,
  extendShopperProfile,
  fetchShopperProfileDetail,
  removeShopperProfileItem,
  skipShopperNextOrder,
  skipShopperProfileItem,
  unskipShopperProfileItem,
} from './adapters/storefront-profiles-list-adapter.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import {
  consumeAccountSuccessFlash,
  setAccountSuccessFlashForAction,
} from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { confirmAction, showError } from './helpers/user-prompt.js';
import {
  DETAIL_LABELS,
  renderDetailSkeleton,
  renderSubscriptionDetail,
} from './subscription-detail-ui.js';

/**
 * Magento profile_edit/index — shopper subscription detail.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   profileId: string|number,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   rootLink?: (path: string) => string,
 *   labels?: Partial<typeof DETAIL_LABELS>,
 * }} options
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionDetail(rootEl, options) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionDetail requires a DOM element.');
  }

  const profileId = Number(options.profileId);
  if (!Number.isFinite(profileId) || profileId < 1) {
    rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(DETAIL_LABELS.missingProfile)}</span></div>`;
    return {
      destroy() {
        rootEl.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }

  ensureRecurBuyStyles();

  const labels = { ...DETAIL_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;

  /** @type {{ busy: boolean, destroyed: boolean, profile: object|null }} */
  const state = {
    busy: false,
    destroyed: false,
    profile: null,
  };

  rootEl.classList.add('recurbuy-subscription-detail');
  rootEl.innerHTML = renderDetailSkeleton(labels);
  rootEl.addEventListener('click', onClick);

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.removeEventListener('click', onClick);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-subscription-detail');
    },
    async refresh() {
      await loadAndRender();
    },
  };

  loadAndRender();
  return api;

  /**
   * @param {MouseEvent} event
   */
  async function onClick(event) {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const control = target.closest('[data-recurbuy-detail-action]');
    if (!(control instanceof HTMLElement)) return;
    event.preventDefault();
    if (state.busy) return;

    const action = control.getAttribute('data-recurbuy-detail-action');
    const itemId = Number(control.getAttribute('data-item-id'));
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }

    const actions = state.profile?.actions && typeof state.profile.actions === 'object'
      ? state.profile.actions
      : {};
    const itemFlags = Array.isArray(actions.items)
      ? actions.items.find((row) => Number(row.item_id) === itemId)
      : null;

    try {
      if (action === 'extend') {
        if (!(await confirmAction(rootEl, actions.extend_confirm || labels.extendConfirm))) return;
        await extendShopperProfile({ authToken, profileId });
        setAccountSuccessFlashForAction('extend');
        await loadAndRender();
        return;
      }
      if (action === 'cancel') {
        if (!(await confirmAction(rootEl, actions.cancel_confirm || labels.cancelConfirm))) return;
        await cancelShopperProfile({ authToken, profileId });
        setAccountSuccessFlashForAction('cancel');
        await loadAndRender();
        return;
      }
      if (action === 'skip-next') {
        if (!(await confirmAction(
          rootEl,
          actions.skip_this_date_confirm || 'Skip the next payment date?',
        ))) return;
        await skipShopperNextOrder({ authToken, profileId });
        setAccountSuccessFlashForAction('skip-next');
        await loadAndRender();
        return;
      }
      if (action === 'skip-item' && itemId > 0) {
        if (!(await confirmAction(rootEl, itemFlags?.skip_confirm || 'Skip this product?'))) return;
        await skipShopperProfileItem({ authToken, profileId, itemId });
        setAccountSuccessFlashForAction('skip-item');
        await loadAndRender();
        return;
      }
      if (action === 'unskip-item' && itemId > 0) {
        if (!(await confirmAction(rootEl, itemFlags?.unskip_confirm || 'Unskip this product?'))) return;
        await unskipShopperProfileItem({ authToken, profileId, itemId });
        setAccountSuccessFlashForAction('unskip-item');
        await loadAndRender();
        return;
      }
      if (action === 'remove-item' && itemId > 0) {
        if (!(await confirmAction(rootEl, actions.remove_confirm || labels.removeConfirm))) return;
        await removeShopperProfileItem({ authToken, profileId, itemId });
        setAccountSuccessFlashForAction('remove-item');
        await loadAndRender();
      }
    } catch (error) {
      if (error?.status === 401) {
        options.onUnauthenticated?.();
        return;
      }
      showError(rootEl, error instanceof Error ? error.message : labels.error);
    }
  }

  async function loadAndRender() {
    if (state.destroyed || state.busy) return;
    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      rootEl.innerHTML = `<div class="message error"><span>${escapeHtml(labels.error)}</span></div>`;
      return;
    }

    state.busy = true;
    rootEl.innerHTML = renderDetailSkeleton(labels);

    try {
      const payload = await fetchShopperProfileDetail({ authToken, profileId });
      if (state.destroyed) return;
      const profile = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      if (!profile || typeof profile !== 'object' || !profile.profile_id) {
        throw new Error(labels.error);
      }
      state.profile = profile;
      const successMessage = consumeAccountSuccessFlash();
      rootEl.innerHTML = renderSubscriptionDetail(profile, {
        labels,
        rootLink: options.rootLink,
        successMessage,
      });
    } catch (error) {
      if (state.destroyed) return;
      if (error?.status === 401) {
        options.onUnauthenticated?.();
      }
      const message = error instanceof Error && error.message ? error.message : labels.error;
      const back = subscriptionAccountHref('list', { rootLink: options.rootLink });
      rootEl.innerHTML = `
<nav class="recurbuy-subscription-detail__nav">
  <a class="action back" href="${escapeHtml(back)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }
}
