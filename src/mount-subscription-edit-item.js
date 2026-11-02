import {
  changeShopperProfileItem,
  fetchShopperProductConfigure,
  fetchShopperProfileDetail,
} from './adapters/storefront-profiles-list-adapter.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { setAccountSuccessFlashForAction } from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { showError } from './helpers/user-prompt.js';
import {
  buildInitialSelection,
  collectConfigureResult,
  EDIT_ITEM_LABELS,
  isEditItemAvailable,
  renderEditItemForm,
  renderEditItemSkeleton,
} from './subscription-edit-item-ui.js';
import {
  buildProfileItemBuyRequest,
  mergeProfileItemBuyRequest,
  readStoredInfoBuyRequest,
  readSubscriptionOptionId,
} from './utils/profile-item-buy-request.js';

/**
 * Magento profile_edit/item — same ChangeProductItem hub as merchant panel.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   profileId: string|number,
 *   itemId: string|number,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   rootLink?: (path: string) => string,
 *   labels?: Partial<typeof EDIT_ITEM_LABELS>,
 *   navigateToDetail?: (profileId: number) => void,
 * }} options
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionEditItem(rootEl, options) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionEditItem requires a DOM element.');
  }

  const profileId = Number(options.profileId);
  const itemId = Number(options.itemId);
  if (!Number.isFinite(profileId) || profileId < 1 || !Number.isFinite(itemId) || itemId < 1) {
    rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(EDIT_ITEM_LABELS.missingProfile)}</span></div>`;
    return {
      destroy() {
        rootEl.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }

  ensureRecurBuyStyles();

  const labels = { ...EDIT_ITEM_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;

  /** @type {{
   *   busy: boolean,
   *   destroyed: boolean,
   *   submitting: boolean,
   *   showOneTimeModal: boolean,
   *   profile: object|null,
   *   item: object|null,
   *   configure: object|null,
   *   qty: number,
   *   selection: ReturnType<typeof buildInitialSelection>,
   *   error: string|null,
   * }} */
  const state = {
    busy: false,
    destroyed: false,
    submitting: false,
    showOneTimeModal: false,
    profile: null,
    item: null,
    configure: null,
    qty: 1,
    selection: buildInitialSelection(null, null),
    error: null,
  };

  rootEl.classList.add('recurbuy-edit-item');
  rootEl.innerHTML = renderEditItemSkeleton(labels);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('input', onChange);
  rootEl.addEventListener('submit', onSubmit);
  rootEl.addEventListener('click', onClick);

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.removeEventListener('change', onChange);
      rootEl.removeEventListener('input', onChange);
      rootEl.removeEventListener('submit', onSubmit);
      rootEl.removeEventListener('click', onClick);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-edit-item');
    },
    async refresh() {
      await loadAndRender();
    },
  };

  loadAndRender();
  return api;

  /**
   * @param {Event} event
   */
  function onChange(event) {
    const { target } = event;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.name === 'qty') {
      const next = Number(target.value);
      if (Number.isFinite(next) && next > 0) {
        state.qty = next;
      }
      return;
    }

    const bundleOption = target.getAttribute('data-recurbuy-bundle-option');
    if (bundleOption) {
      const value = Number(target.value);
      if (Number.isFinite(value)) {
        state.selection = {
          ...state.selection,
          bundleSelection: {
            ...state.selection.bundleSelection,
            [bundleOption]: value,
          },
        };
        state.error = null;
        paintForm();
      }
      return;
    }

    const bundleQty = target.getAttribute('data-recurbuy-bundle-qty');
    if (bundleQty) {
      const value = Number(target.value);
      if (Number.isFinite(value) && value > 0) {
        state.selection = {
          ...state.selection,
          bundleQty: {
            ...state.selection.bundleQty,
            [bundleQty]: value,
          },
        };
      }
      return;
    }

    const groupedQty = target.getAttribute('data-recurbuy-grouped-qty');
    if (groupedQty) {
      const value = Number(target.value);
      if (Number.isFinite(value) && value >= 0) {
        state.selection = {
          ...state.selection,
          groupedQty: {
            ...state.selection.groupedQty,
            [groupedQty]: value,
          },
        };
      }
    }
  }

  /**
   * @param {MouseEvent} event
   */
  async function onClick(event) {
    const swatch = event.target instanceof Element
      ? event.target.closest('[data-recurbuy-configurable-attribute]')
      : null;
    if (swatch instanceof HTMLElement && !swatch.hasAttribute('disabled')) {
      event.preventDefault();
      const attributeId = swatch.getAttribute('data-recurbuy-configurable-attribute');
      const valueIndex = Number(swatch.getAttribute('data-value-index'));
      if (attributeId && Number.isFinite(valueIndex)) {
        state.selection = {
          ...state.selection,
          configurable: {
            ...state.selection.configurable,
            [attributeId]: valueIndex,
          },
        };
        state.error = null;
        paintForm();
      }
      return;
    }

    const target = event.target instanceof Element
      ? event.target.closest('[data-recurbuy-one-time]')
      : null;
    if (!(target instanceof HTMLElement)) return;

    event.preventDefault();
    const mode = target.getAttribute('data-recurbuy-one-time');
    if (mode === 'cancel') {
      state.showOneTimeModal = false;
      paintForm();
      return;
    }
    if (mode === '0' || mode === '1') {
      state.showOneTimeModal = false;
      await submitChange(mode === '1');
    }
  }

  /**
   * @param {SubmitEvent} event
   */
  async function onSubmit(event) {
    event.preventDefault();
    if (state.busy || state.submitting || !state.profile || !state.item) return;

    const actions = state.profile.actions && typeof state.profile.actions === 'object'
      ? state.profile.actions
      : {};
    if (!isEditItemAvailable(state.item, actions)) {
      return;
    }

    const collected = collectConfigureResult(state.configure, state.selection, labels);
    if (!collected.ok) {
      state.error = collected.error;
      paintForm();
      return;
    }

    const canOneTime = Boolean(actions.can_one_time_edit_product_item);
    if (canOneTime) {
      state.error = null;
      state.showOneTimeModal = true;
      paintForm();
      return;
    }

    await submitChange(false);
  }

  /**
   * @param {boolean} isOneTimeOnly
   */
  async function submitChange(isOneTimeOnly) {
    if (state.busy || state.submitting || !state.profile || !state.item) return;

    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }

    const collected = collectConfigureResult(state.configure, state.selection, labels);
    if (!collected.ok) {
      state.error = collected.error;
      paintForm();
      return;
    }

    const productId = Number(state.item.product_id);
    const formBuyRequest = buildProfileItemBuyRequest(
      productId,
      state.qty,
      collected.result,
    );
    const buyRequest = mergeProfileItemBuyRequest(
      readStoredInfoBuyRequest(state.item.product_options),
      formBuyRequest,
      readSubscriptionOptionId(state.item),
    );

    state.submitting = true;
    state.error = null;
    paintForm();

    try {
      await changeShopperProfileItem({
        authToken,
        profileId,
        itemId,
        buyRequest,
        isOneTimeOnly,
      });
      if (state.destroyed) return;
      setAccountSuccessFlashForAction('save-item');
      if (typeof options.navigateToDetail === 'function') {
        options.navigateToDetail(profileId);
        return;
      }
      if (typeof window !== 'undefined') {
        window.location.hash = `#rb/detail/${profileId}`;
      }
    } catch (error) {
      if (state.destroyed) return;
      if (error?.status === 401) {
        options.onUnauthenticated?.();
        return;
      }
      showError(rootEl, error instanceof Error ? error.message : labels.error);
      state.error = error instanceof Error && error.message ? error.message : labels.error;
      paintForm();
    } finally {
      state.submitting = false;
      if (!state.destroyed) {
        paintForm();
      }
    }
  }

  function paintForm() {
    if (!state.profile || !state.item) return;
    const actions = state.profile.actions && typeof state.profile.actions === 'object'
      ? state.profile.actions
      : {};
    rootEl.innerHTML = renderEditItemForm({
      profile: state.profile,
      item: state.item,
      configure: state.configure,
      qty: state.qty,
      selection: state.selection,
      submitting: state.submitting,
      error: state.error,
      showOneTimeModal: state.showOneTimeModal,
      canOneTimeEdit: Boolean(actions.can_one_time_edit_product_item),
      labels,
      rootLink: options.rootLink,
    });
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
    rootEl.innerHTML = renderEditItemSkeleton(labels);

    try {
      const detailPayload = await fetchShopperProfileDetail({ authToken, profileId });
      if (state.destroyed) return;

      const profile = detailPayload?.data && typeof detailPayload.data === 'object'
        ? detailPayload.data
        : detailPayload;
      if (!profile || typeof profile !== 'object' || !profile.profile_id) {
        throw new Error(labels.error);
      }

      const items = Array.isArray(profile.items) ? profile.items : [];
      const item = items.find((row) => Number(row?.item_id ?? row?.id) === itemId);
      if (!item) {
        throw new Error(labels.missingProfile);
      }

      state.profile = profile;
      state.item = item;
      state.qty = Number(item.qty) > 0 ? Number(item.qty) : 1;

      const productId = Number(item.product_id);
      const planId = Number(profile.plan_id);
      let configure = null;
      if (Number.isFinite(productId) && productId > 0) {
        try {
          configure = await fetchShopperProductConfigure({
            authToken,
            productId,
            planId: Number.isFinite(planId) && planId > 0 ? planId : null,
          });
        } catch (configureError) {
          // Simple products may not need configure; keep qty-only when schema fails.
          if (configureError?.status && configureError.status !== 404) {
            throw configureError;
          }
        }
      }

      if (state.destroyed) return;
      state.configure = configure && typeof configure === 'object' ? configure : null;
      state.selection = buildInitialSelection(state.configure, item);
      state.error = null;
      paintForm();
    } catch (error) {
      if (state.destroyed) return;
      if (error?.status === 401) {
        options.onUnauthenticated?.();
      }
      const message = error instanceof Error && error.message ? error.message : labels.error;
      const back = subscriptionAccountHref('detail', {
        profileId,
        rootLink: options.rootLink,
      });
      rootEl.innerHTML = `
<nav class="recurbuy-edit-item__nav">
  <a class="action back" href="${escapeHtml(back)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }
}
