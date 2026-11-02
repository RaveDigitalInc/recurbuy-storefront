import { changeShopperNextPaymentDate, fetchShopperProfileDetail } from './adapters/storefront-profiles-list-adapter.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { setAccountSuccessFlashForAction } from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import {
  joinEngineUtcDateOnly,
  localCalendarDateYmd,
  splitEngineUtcDateTime,
} from './helpers/engine-utc-datetime.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { showError } from './helpers/user-prompt.js';
import {
  EDIT_NEXT_PAYMENT_DATE_LABELS,
  renderEditNextPaymentDateForm,
  renderEditNextPaymentDateSkeleton,
} from './subscription-edit-next-payment-date-ui.js';

/**
 * Magento profile_edit/nextPaymentDate — same ChangeNextPaymentDate hub as merchant panel.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   profileId: string|number,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   rootLink?: (path: string) => string,
 *   labels?: Partial<typeof EDIT_NEXT_PAYMENT_DATE_LABELS>,
 *   navigateToDetail?: (profileId: number) => void,
 * }} options
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionEditNextPaymentDate(rootEl, options) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionEditNextPaymentDate requires a DOM element.');
  }

  const profileId = Number(options.profileId);
  if (!Number.isFinite(profileId) || profileId < 1) {
    rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(EDIT_NEXT_PAYMENT_DATE_LABELS.missingProfile)}</span></div>`;
    return {
      destroy() {
        rootEl.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }

  ensureRecurBuyStyles();

  const labels = { ...EDIT_NEXT_PAYMENT_DATE_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;

  /** @type {{
   *   busy: boolean,
   *   destroyed: boolean,
   *   submitting: boolean,
   *   profile: object|null,
   *   date: string,
   * }} */
  const state = {
    busy: false,
    destroyed: false,
    submitting: false,
    profile: null,
    date: '',
  };

  rootEl.classList.add('recurbuy-edit-next-date');
  rootEl.innerHTML = renderEditNextPaymentDateSkeleton(labels);
  rootEl.addEventListener('input', onInput);
  rootEl.addEventListener('change', onInput);
  rootEl.addEventListener('submit', onSubmit);

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.removeEventListener('input', onInput);
      rootEl.removeEventListener('change', onInput);
      rootEl.removeEventListener('submit', onSubmit);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-edit-next-date');
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
  function onInput(event) {
    const { target } = event;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name === 'next_payment_date') {
      state.date = target.value;
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
    const dateInput = form.querySelector('input[name="next_payment_date"]');
    const date = dateInput instanceof HTMLInputElement ? dateInput.value : state.date;
    const joined = joinEngineUtcDateOnly(date);
    if (joined == null) {
      showError(rootEl, labels.required);
      return;
    }

    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }

    state.date = date;
    state.submitting = true;
    paintForm();

    try {
      await changeShopperNextPaymentDate({
        authToken,
        profileId,
        newNextPaymentDate: joined,
      });
      if (state.destroyed) return;
      setAccountSuccessFlashForAction('save-next-payment-date');
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
    rootEl.innerHTML = renderEditNextPaymentDateForm({
      profile: state.profile,
      date: state.date,
      minDate: localCalendarDateYmd(),
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
    rootEl.innerHTML = renderEditNextPaymentDateSkeleton(labels);

    try {
      const detailPayload = await fetchShopperProfileDetail({ authToken, profileId });
      if (state.destroyed) return;

      const profile = detailPayload?.data && typeof detailPayload.data === 'object'
        ? detailPayload.data
        : detailPayload;
      if (!profile || typeof profile !== 'object' || !profile.profile_id) {
        throw new Error(labels.error);
      }

      const nextPayment = profile.next_payment && typeof profile.next_payment === 'object'
        ? profile.next_payment
        : {};
      const split = splitEngineUtcDateTime(
        typeof nextPayment.payment_date === 'string' ? nextPayment.payment_date : '',
      );

      state.profile = profile;
      state.date = split.date;
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
<nav class="recurbuy-edit-next-date__nav">
  <a class="action back" href="${escapeHtml(back)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }
}
