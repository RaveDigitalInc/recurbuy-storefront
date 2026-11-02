import { escapeHtml } from './helpers/dom-html.js';
import { localCalendarDateYmd } from './helpers/engine-utc-datetime.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';

export const EDIT_NEXT_PAYMENT_DATE_LABELS = {
  title: 'Edit Next Payment Date',
  back: 'Back to Subscription',
  date: 'Next Payment Date',
  save: 'Save',
  cancel: 'Cancel',
  unavailable: 'Changing the next payment date is not available for this subscription.',
  missingProfile: 'Missing profile. Open a subscription from My Subscriptions.',
  loading: 'Loading next payment date…',
  error: 'Unable to load next payment date.',
  required: 'Enter a valid date.',
};

/**
 * @param {Partial<typeof EDIT_NEXT_PAYMENT_DATE_LABELS>} [labels]
 * @returns {string}
 */
export function renderEditNextPaymentDateSkeleton(labels = {}) {
  const copy = { ...EDIT_NEXT_PAYMENT_DATE_LABELS, ...labels };
  return `<div class="recurbuy-edit-next-date__skeleton message info"><span>${escapeHtml(copy.loading)}</span></div>`;
}

/**
 * Magento `next_payment_date.phtml` — date calendar only (no time).
 *
 * @param {{
 *   profile: object,
 *   date?: string,
 *   minDate?: string,
 *   submitting?: boolean,
 *   labels?: Partial<typeof EDIT_NEXT_PAYMENT_DATE_LABELS>,
 *   rootLink?: (path: string) => string,
 * }} input
 * @returns {string}
 */
export function renderEditNextPaymentDateForm(input) {
  const labels = { ...EDIT_NEXT_PAYMENT_DATE_LABELS, ...(input.labels || {}) };
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const profileId = Number(profile.profile_id);
  const backHref = subscriptionAccountHref('detail', {
    profileId,
    rootLink: input.rootLink,
  });
  const actions = profile.actions && typeof profile.actions === 'object' ? profile.actions : {};
  const canEdit = Boolean(actions.is_edit_next_payment_date_available);
  const submitting = Boolean(input.submitting);
  const date = typeof input.date === 'string' ? input.date : '';
  const minDate = typeof input.minDate === 'string' && input.minDate !== ''
    ? input.minDate
    : localCalendarDateYmd();

  if (!canEdit) {
    return `
<nav class="recurbuy-edit-next-date__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message info"><span>${escapeHtml(labels.unavailable)}</span></div>`;
  }

  const saveDisabled = submitting || date.trim() === ''
    ? ' disabled'
    : '';

  return `
<nav class="recurbuy-edit-next-date__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<header class="recurbuy-edit-next-date__header">
  <h1 class="recurbuy-edit-next-date__title">${escapeHtml(labels.title)}</h1>
  ${profile.increment_id
    ? `<p class="recurbuy-edit-next-date__meta">${escapeHtml(String(profile.increment_id))}</p>`
    : ''}
</header>
<div class="recurbuy-edit-next-date__card">
  <form class="recurbuy-edit-next-date__form" data-recurbuy-edit-next-date-form novalidate>
    <fieldset class="fieldset" ${submitting ? 'disabled' : ''}>
      <div class="field next-payment-date">
        <div class="control next-payment-date">
          <input
            type="date"
            id="recurbuy-next-payment-date"
            name="next_payment_date"
            class="input-text"
            aria-label="${escapeHtml(labels.date)}"
            value="${escapeHtml(date)}"
            min="${escapeHtml(minDate)}"
            required
          />
        </div>
      </div>
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
