/**
 * Shopper `#rb/edit-payment` — radio list of Commerce saved vault cards (`saved_payment_tokens`).
 *
 * Named gap: APS Hosted Fields / add-new-card UI is out of this slice (select existing cards only).
 * Magento AccS mid-scale layout mirrors edit-plan / edit-next-payment-date.
 */

import { escapeHtml } from './helpers/dom-html.js';
import { renderVaultCreditCardHtml } from './helpers/vault-credit-card-html.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';

export const EDIT_PAYMENT_LABELS = {
  title: 'Edit Payment Details',
  back: 'Back to Subscription',
  currentMethod: 'Current payment method',
  currentMissing: 'No card on this subscription yet. Choose a saved card below.',
  chooseCard: 'Choose a saved card',
  save: 'Save',
  cancel: 'Cancel',
  empty: 'No saved cards…',
  unavailable: 'Changing the payment method is not available for this subscription.',
  missingProfile: 'Missing profile. Open a subscription from My Subscriptions.',
  loading: 'Loading saved cards…',
  error: 'Unable to load payment methods.',
};

/**
 * @param {Partial<typeof EDIT_PAYMENT_LABELS>} [labels]
 * @returns {string}
 */
export function renderEditPaymentSkeleton(labels = {}) {
  const copy = { ...EDIT_PAYMENT_LABELS, ...labels };
  return `<div class="recurbuy-edit-payment__skeleton message info"><span>${escapeHtml(copy.loading)}</span></div>`;
}

/**
 * Safe radio element id from a vault public_hash.
 *
 * @param {string} publicHash
 * @returns {string}
 */
export function editPaymentCardRadioId(publicHash) {
  const safe = String(publicHash).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `recurbuy-edit-payment-${safe}`;
}

/**
 * Prefer AccS credit-card markup; fall back to vault label text.
 *
 * @param {{
 *   label?: string|null,
 *   details?: Record<string, unknown>|null,
 *   public_hash?: string,
 * }} token
 * @returns {string}
 */
export function renderSavedCardBody(token) {
  const vaultHtml = renderVaultCreditCardHtml(token?.details);
  if (vaultHtml) {
    return vaultHtml;
  }
  const label = typeof token?.label === 'string' ? token.label.trim() : '';
  if (label !== '') {
    return `<span class="recurbuy-edit-payment__option-title">${escapeHtml(label)}</span>`;
  }
  const hash = typeof token?.public_hash === 'string' ? token.public_hash : '';
  if (hash !== '') {
    return `<span class="recurbuy-edit-payment__option-title">${escapeHtml(hash.slice(0, 8))}</span>`;
  }
  return '';
}

/**
 * @param {{
 *   profileId: number,
 *   incrementId?: string|null,
 *   isEditPaymentAvailable: boolean,
 *   currentHtml?: string|null,
 *   currentLabel?: string|null,
 *   currentDetails?: Record<string, unknown>|null,
 *   tokens: Array<{
 *     public_hash: string,
 *     payment_method_code?: string,
 *     type?: string,
 *     details?: Record<string, unknown>|null,
 *     label: string,
 *   }>,
 *   selectedPublicHash?: string|null,
 *   submitting?: boolean,
 *   labels?: Partial<typeof EDIT_PAYMENT_LABELS>,
 *   rootLink?: (path: string) => string,
 * }} input
 * @returns {string}
 */
export function renderEditPaymentForm(input) {
  const labels = { ...EDIT_PAYMENT_LABELS, ...(input.labels || {}) };
  const profileId = Number(input.profileId);
  const backHref = subscriptionAccountHref('detail', {
    profileId,
    rootLink: input.rootLink,
  });
  const canEdit = Boolean(input.isEditPaymentAvailable);
  const tokens = Array.isArray(input.tokens) ? input.tokens : [];
  const selected = typeof input.selectedPublicHash === 'string' && input.selectedPublicHash !== ''
    ? input.selectedPublicHash
    : (tokens[0]?.public_hash ?? '');
  const submitting = Boolean(input.submitting);
  const incrementId = typeof input.incrementId === 'string' ? input.incrementId : '';

  const currentBody = resolveCurrentPaymentBody(input, labels);

  if (!canEdit) {
    return `
<nav class="recurbuy-edit-payment__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message info"><span>${escapeHtml(labels.unavailable)}</span></div>`;
  }

  const optionsHtml = tokens.length === 0
    ? `<div class="message info empty"><span>${escapeHtml(labels.empty)}</span></div>`
    : `<div class="recurbuy-edit-payment__options" role="radiogroup" aria-label="${escapeHtml(labels.chooseCard)}">
${tokens.map((token) => {
    const hash = typeof token.public_hash === 'string' ? token.public_hash : '';
    const id = editPaymentCardRadioId(hash);
    const checked = hash === selected ? ' checked' : '';
    return `
  <label class="recurbuy-edit-payment__option" for="${escapeHtml(id)}">
    <input
      type="radio"
      id="${escapeHtml(id)}"
      name="payment_public_hash"
      value="${escapeHtml(hash)}"
      class="radio"
      required${checked}${submitting ? ' disabled' : ''}
    >
    <span class="recurbuy-edit-payment__option-label">
      ${renderSavedCardBody(token)}
    </span>
  </label>`;
  }).join('')}
</div>`;

  const saveDisabled = tokens.length === 0 || submitting || selected === ''
    ? ' disabled'
    : '';

  return `
<nav class="recurbuy-edit-payment__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<header class="recurbuy-edit-payment__header">
  <h1 class="recurbuy-edit-payment__title">${escapeHtml(labels.title)}</h1>
  ${incrementId
    ? `<p class="recurbuy-edit-payment__meta">${escapeHtml(incrementId)}</p>`
    : ''}
</header>
<div class="recurbuy-edit-payment__card">
  ${currentBody
    ? `<div class="recurbuy-edit-payment__current">
    <span class="label">${escapeHtml(labels.currentMethod)}</span>
    <div class="recurbuy-edit-payment__current-body">${currentBody}</div>
  </div>`
    : ''}
  <form class="recurbuy-edit-payment__form" data-recurbuy-edit-payment-form novalidate>
    <fieldset class="fieldset" ${submitting ? 'disabled' : ''}>
      <legend>${escapeHtml(labels.chooseCard)}</legend>
      ${optionsHtml}
    </fieldset>
    <div class="actions-toolbar">
      <button type="submit" class="button primary"${saveDisabled}>
        <span>${escapeHtml(labels.save)}</span>
      </button>
      <a class="button secondary" href="${escapeHtml(backHref)}"><span>${escapeHtml(labels.cancel)}</span></a>
    </div>
  </form>
</div>`;
}

/**
 * Current block must reflect the profile vault stamp only — never the radio preselect
 * (first wallet card). APS Hosted Fields can charge a card that never entered Magento vault.
 *
 * @param {{
 *   currentHtml?: string|null,
 *   currentLabel?: string|null,
 *   currentDetails?: Record<string, unknown>|null,
 * }} input
 * @param {typeof EDIT_PAYMENT_LABELS} labels
 * @returns {string}
 */
function resolveCurrentPaymentBody(input, labels) {
  // Prefer client-side AccS markup from details so placeholders like UNKNOWN never leak
  // from a stale server `html` payload.
  const fromDetails = renderVaultCreditCardHtml(input.currentDetails);
  if (fromDetails) {
    return fromDetails;
  }

  if (typeof input.currentHtml === 'string' && input.currentHtml.trim() !== '') {
    return stripPlaceholderCardTypeHtml(input.currentHtml);
  }

  if (typeof input.currentLabel === 'string' && input.currentLabel.trim() !== '') {
    return `<strong>${escapeHtml(input.currentLabel.trim())}</strong>`;
  }

  return `<span class="recurbuy-edit-payment__current-missing">${escapeHtml(labels.currentMissing)}</span>`;
}

/**
 * Drop AccS card-type rows that only echo Commerce placeholders (e.g. UNKNOWN).
 *
 * @param {string} html
 * @returns {string}
 */
export function stripPlaceholderCardTypeHtml(html) {
  return String(html).replace(
    /<div class="card-type">\s*<span>\s*(?:UNKNOWN|OT|UN)\s*<\/span>\s*<\/div>/gi,
    '',
  );
}
