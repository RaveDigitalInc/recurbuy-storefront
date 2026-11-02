import {
  changeShopperProfilePlan,
  fetchShopperAvailablePlans,
  fetchShopperProfileDetail,
} from './adapters/storefront-profiles-list-adapter.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { setAccountSuccessFlashForAction } from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { showError } from './helpers/user-prompt.js';
import {
  EDIT_PLAN_LABELS,
  renderEditPlanForm,
  renderEditPlanSkeleton,
} from './subscription-edit-plan-ui.js';

/**
 * Magento profile_edit/plan — same ChangePlan hub as merchant panel.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   profileId: string|number,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   rootLink?: (path: string) => string,
 *   labels?: Partial<typeof EDIT_PLAN_LABELS>,
 *   navigateToDetail?: (profileId: number) => void,
 * }} options
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionEditPlan(rootEl, options) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionEditPlan requires a DOM element.');
  }

  const profileId = Number(options.profileId);
  if (!Number.isFinite(profileId) || profileId < 1) {
    rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(EDIT_PLAN_LABELS.missingProfile)}</span></div>`;
    return {
      destroy() {
        rootEl.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }

  ensureRecurBuyStyles();

  const labels = { ...EDIT_PLAN_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;

  /** @type {{
   *   busy: boolean,
   *   destroyed: boolean,
   *   submitting: boolean,
   *   profile: object|null,
   *   plans: Array<{ id: number, name: string }>,
   *   selectedPlanId: number|null,
   * }} */
  const state = {
    busy: false,
    destroyed: false,
    submitting: false,
    profile: null,
    plans: [],
    selectedPlanId: null,
  };

  rootEl.classList.add('recurbuy-edit-plan');
  rootEl.innerHTML = renderEditPlanSkeleton(labels);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('submit', onSubmit);

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.removeEventListener('change', onChange);
      rootEl.removeEventListener('submit', onSubmit);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-edit-plan');
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
    if (!(target instanceof HTMLInputElement) || target.name !== 'new_plan_id') return;
    const next = Number(target.value);
    if (Number.isFinite(next) && next > 0) {
      state.selectedPlanId = next;
    }
  }

  /**
   * @param {SubmitEvent} event
   */
  async function onSubmit(event) {
    event.preventDefault();
    if (state.busy || state.submitting || !state.profile) return;

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const checked = form.querySelector('input[name="new_plan_id"]:checked');
    const newPlanId = checked instanceof HTMLInputElement
      ? Number(checked.value)
      : Number(state.selectedPlanId);
    if (!Number.isFinite(newPlanId) || newPlanId < 1) return;

    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }

    state.submitting = true;
    paintForm();

    try {
      await changeShopperProfilePlan({ authToken, profileId, newPlanId });
      if (state.destroyed) return;
      setAccountSuccessFlashForAction('save-plan');
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
    } finally {
      state.submitting = false;
      if (!state.destroyed) {
        paintForm();
      }
    }
  }

  function paintForm() {
    if (!state.profile) return;
    rootEl.innerHTML = renderEditPlanForm({
      profile: state.profile,
      plans: state.plans,
      selectedPlanId: state.selectedPlanId,
      submitting: state.submitting,
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
    rootEl.innerHTML = renderEditPlanSkeleton(labels);

    try {
      const [detailPayload, plans] = await Promise.all([
        fetchShopperProfileDetail({ authToken, profileId }),
        fetchShopperAvailablePlans({ authToken, profileId }),
      ]);
      if (state.destroyed) return;

      const profile = detailPayload?.data && typeof detailPayload.data === 'object'
        ? detailPayload.data
        : detailPayload;
      if (!profile || typeof profile !== 'object' || !profile.profile_id) {
        throw new Error(labels.error);
      }

      state.profile = profile;
      state.plans = plans;
      state.selectedPlanId = plans[0]?.id ?? null;
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
<nav class="recurbuy-edit-plan__nav">
  <a class="action back" href="${escapeHtml(back)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }
}
