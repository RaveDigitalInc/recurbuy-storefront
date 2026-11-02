import { escapeHtml } from './helpers/dom-html.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';

export const EDIT_PLAN_LABELS = {
  title: 'Change Subscription Plan',
  back: 'Back to Subscription',
  currentPlan: 'Current plan',
  choosePlan: 'Choose a new plan',
  save: 'Save Subscription',
  cancel: 'Cancel',
  empty: 'No other plans are available for this subscription.',
  unavailable: 'Changing the plan is not available for this subscription.',
  missingProfile: 'Missing profile. Open a subscription from My Subscriptions.',
  loading: 'Loading plans…',
  error: 'Unable to load plan options.',
  products: 'Product(s)',
};

/**
 * @param {Partial<typeof EDIT_PLAN_LABELS>} [labels]
 * @returns {string}
 */
export function renderEditPlanSkeleton(labels = {}) {
  const copy = { ...EDIT_PLAN_LABELS, ...labels };
  return `<div class="recurbuy-edit-plan__skeleton message info"><span>${escapeHtml(copy.loading)}</span></div>`;
}

/**
 * @param {{
 *   profile: object,
 *   plans: Array<{ id: number, name: string }>,
 *   selectedPlanId?: number|null,
 *   submitting?: boolean,
 *   labels?: Partial<typeof EDIT_PLAN_LABELS>,
 *   rootLink?: (path: string) => string,
 * }} input
 * @returns {string}
 */
export function renderEditPlanForm(input) {
  const labels = { ...EDIT_PLAN_LABELS, ...(input.labels || {}) };
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const profileId = Number(profile.profile_id);
  const backHref = subscriptionAccountHref('detail', {
    profileId,
    rootLink: input.rootLink,
  });
  const actions = profile.actions && typeof profile.actions === 'object' ? profile.actions : {};
  const canEdit = Boolean(actions.is_edit_plan_available);
  const plans = Array.isArray(input.plans) ? input.plans : [];
  const selected = Number(input.selectedPlanId) > 0
    ? Number(input.selectedPlanId)
    : (plans[0]?.id ?? 0);
  const submitting = Boolean(input.submitting);

  const productNames = Array.isArray(profile.items)
    ? profile.items
      .filter((item) => item && !item.parent_item_id)
      .map((item) => (typeof item.name === 'string' ? item.name : ''))
      .filter(Boolean)
    : [];

  if (!canEdit) {
    return `
<nav class="recurbuy-edit-plan__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message info"><span>${escapeHtml(labels.unavailable)}</span></div>`;
  }

  const optionsHtml = plans.length === 0
    ? `<div class="message info empty"><span>${escapeHtml(labels.empty)}</span></div>`
    : `<div class="recurbuy-edit-plan__options" role="radiogroup" aria-label="${escapeHtml(labels.choosePlan)}">
${plans.map((plan) => {
    const id = `recurbuy-edit-plan-${plan.id}`;
    const checked = plan.id === selected ? ' checked' : '';
    return `
  <label class="recurbuy-edit-plan__option" for="${escapeHtml(id)}">
    <input
      type="radio"
      id="${escapeHtml(id)}"
      name="new_plan_id"
      value="${plan.id}"
      class="radio"
      required${checked}${submitting ? ' disabled' : ''}
    >
    <span class="recurbuy-edit-plan__option-label">${escapeHtml(plan.name)}</span>
  </label>`;
  }).join('')}
</div>`;

  const saveDisabled = plans.length === 0 || submitting || selected < 1
    ? ' disabled'
    : '';

  return `
<nav class="recurbuy-edit-plan__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<header class="recurbuy-edit-plan__header">
  <h1 class="recurbuy-edit-plan__title">${escapeHtml(labels.title)}</h1>
  ${profile.increment_id
    ? `<p class="recurbuy-edit-plan__meta">${escapeHtml(String(profile.increment_id))}</p>`
    : ''}
</header>
<div class="recurbuy-edit-plan__card">
  ${productNames.length
    ? `<div class="recurbuy-edit-plan__products">
    <span class="recurbuy-edit-plan__products-label">${escapeHtml(labels.products)}</span>
    <ul>${productNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
  </div>`
    : ''}
  <p class="recurbuy-edit-plan__current">
    <span class="label">${escapeHtml(labels.currentPlan)}</span>
    <strong>${escapeHtml(profile.plan_name || '')}</strong>
  </p>
  <form class="recurbuy-edit-plan__form" data-recurbuy-edit-plan-form novalidate>
    <fieldset class="fieldset" ${submitting ? 'disabled' : ''}>
      <legend>${escapeHtml(labels.choosePlan)}</legend>
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
