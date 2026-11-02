import {
  changeShopperSavedPaymentCard,
  fetchShopperPaymentEditConfig,
  fetchShopperProfileDetail,
} from './adapters/storefront-profiles-list-adapter.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import { getShopperAuthToken } from './auth.js';
import { setAccountSuccessFlashForAction } from './helpers/account-success-flash.js';
import { escapeHtml } from './helpers/dom-html.js';
import { ensureRecurBuyStyles } from './helpers/ensure-styles.js';
import { showError } from './helpers/user-prompt.js';
import {
  EDIT_PAYMENT_LABELS,
  renderEditPaymentForm,
  renderEditPaymentSkeleton,
} from './subscription-edit-payment-ui.js';

/**
 * Magento profile_edit/payment — select a Commerce saved vault card.
 * Hosted Fields / add-new-card UI is a later slice.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   profileId: string|number,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 *   rootLink?: (path: string) => string,
 *   labels?: Partial<typeof EDIT_PAYMENT_LABELS>,
 *   navigateToDetail?: (profileId: number) => void,
 * }} options
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountSubscriptionEditPayment(rootEl, options) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] mountSubscriptionEditPayment requires a DOM element.');
  }

  const profileId = Number(options.profileId);
  if (!Number.isFinite(profileId) || profileId < 1) {
    rootEl.innerHTML = `<div class="message info empty"><span>${escapeHtml(EDIT_PAYMENT_LABELS.missingProfile)}</span></div>`;
    return {
      destroy() {
        rootEl.replaceChildren();
      },
      refresh: async () => undefined,
    };
  }

  ensureRecurBuyStyles();

  const labels = { ...EDIT_PAYMENT_LABELS, ...(options.labels || {}) };
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;

  /** @type {{
   *   busy: boolean,
   *   destroyed: boolean,
   *   submitting: boolean,
   *   incrementId: string,
   *   isEditPaymentAvailable: boolean,
   *   currentLabel: string,
   *   currentDetails: Record<string, unknown>|null,
   *   currentHtml: string,
   *   tokens: Array<{
   *     public_hash: string,
   *     payment_method_code: string,
   *     type: string,
   *     details: Record<string, unknown>|null,
   *     label: string,
   *   }>,
   *   selectedPublicHash: string|null,
   * }} */
  const state = {
    busy: false,
    destroyed: false,
    submitting: false,
    incrementId: '',
    isEditPaymentAvailable: false,
    currentLabel: '',
    currentDetails: null,
    currentHtml: '',
    tokens: [],
    selectedPublicHash: null,
  };

  rootEl.classList.add('recurbuy-edit-payment');
  rootEl.innerHTML = renderEditPaymentSkeleton(labels);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('submit', onSubmit);

  const api = {
    destroy() {
      state.destroyed = true;
      rootEl.removeEventListener('change', onChange);
      rootEl.removeEventListener('submit', onSubmit);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-edit-payment');
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
    if (!(target instanceof HTMLInputElement) || target.name !== 'payment_public_hash') return;
    if (typeof target.value === 'string' && target.value !== '') {
      state.selectedPublicHash = target.value;
    }
  }

  /**
   * @param {SubmitEvent} event
   */
  async function onSubmit(event) {
    event.preventDefault();
    if (state.busy || state.submitting || !state.isEditPaymentAvailable) return;

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const checked = form.querySelector('input[name="payment_public_hash"]:checked');
    const publicHash = checked instanceof HTMLInputElement
      ? checked.value
      : (state.selectedPublicHash || '');
    if (typeof publicHash !== 'string' || publicHash.trim() === '') return;

    const authToken = getAuthToken();
    if (!authToken) {
      options.onUnauthenticated?.();
      return;
    }

    const matched = state.tokens.find((token) => token.public_hash === publicHash);
    const paymentMethodCode = matched && typeof matched.payment_method_code === 'string'
      ? matched.payment_method_code
      : null;

    state.selectedPublicHash = publicHash;
    state.submitting = true;
    paintForm();

    try {
      await changeShopperSavedPaymentCard({
        authToken,
        profileId,
        publicHash,
        paymentMethodCode,
      });
      if (state.destroyed) return;
      setAccountSuccessFlashForAction('save-payment');
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
    rootEl.innerHTML = renderEditPaymentForm({
      profileId,
      incrementId: state.incrementId || null,
      isEditPaymentAvailable: state.isEditPaymentAvailable,
      currentHtml: state.currentHtml || null,
      currentLabel: state.currentLabel || null,
      currentDetails: state.currentDetails,
      tokens: state.tokens,
      selectedPublicHash: state.selectedPublicHash,
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
    rootEl.innerHTML = renderEditPaymentSkeleton(labels);

    try {
      const [config, detailPayload] = await Promise.all([
        fetchShopperPaymentEditConfig({ authToken, profileId }),
        fetchShopperProfileDetail({ authToken, profileId }).catch(() => null),
      ]);
      if (state.destroyed) return;

      const profile = detailPayload?.data && typeof detailPayload.data === 'object'
        ? detailPayload.data
        : detailPayload;
      const incrementId = profile && typeof profile === 'object' && typeof profile.increment_id === 'string'
        ? profile.increment_id
        : '';

      const tokens = Array.isArray(config.saved_payment_tokens) ? config.saved_payment_tokens : [];
      const currentHash = typeof config.current?.payment_public_hash === 'string'
        ? config.current.payment_public_hash
        : '';
      const matchedToken = currentHash
        ? tokens.find((token) => token.public_hash === currentHash)
        : null;
      const resolvedCurrent = resolveCurrentVaultDisplay(config.current, matchedToken);
      const selectedFromCurrent = tokens.some((token) => token.public_hash === currentHash)
        ? currentHash
        : (tokens[0]?.public_hash ?? null);

      state.incrementId = incrementId;
      state.isEditPaymentAvailable = Boolean(config.is_edit_payment_available);
      state.currentLabel = resolvedCurrent.label;
      state.currentDetails = resolvedCurrent.details;
      state.currentHtml = resolvedCurrent.html;
      state.tokens = tokens;
      state.selectedPublicHash = selectedFromCurrent;
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
<nav class="recurbuy-edit-payment__nav">
  <a class="action back" href="${escapeHtml(back)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message error"><span>${escapeHtml(message)}</span></div>`;
    } finally {
      state.busy = false;
    }
  }
}

/**
 * Prefer config.current vault fields; fall back to the matched saved token.
 *
 * @param {Record<string, unknown>|null|undefined} current
 * @param {{
 *   label?: string,
 *   details?: Record<string, unknown>|null,
 * }|null|undefined} matchedToken
 * @returns {{
 *   label: string,
 *   details: Record<string, unknown>|null,
 *   html: string,
 * }}
 */
function resolveCurrentVaultDisplay(current, matchedToken) {
  let details = null;
  if (current?.details && typeof current.details === 'object') {
    details = /** @type {Record<string, unknown>} */ (current.details);
  } else if (matchedToken?.details && typeof matchedToken.details === 'object') {
    details = matchedToken.details;
  }

  let label = '';
  if (typeof current?.label === 'string' && current.label.trim() !== '') {
    label = current.label.trim();
  } else if (typeof matchedToken?.label === 'string' && matchedToken.label.trim() !== '') {
    label = matchedToken.label.trim();
  } else if (
    typeof current?.payment_method_title === 'string'
    && current.payment_method_title.trim() !== ''
  ) {
    label = current.payment_method_title.trim();
  }

  const html = typeof current?.html === 'string' ? current.html : '';

  return { label, details, html };
}
