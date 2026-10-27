import {
  ONE_TIME_VALUE,
  bindCustomOptions,
  bindPurchaseControls,
  renderCustomOptions,
  renderDropdownOptions,
  renderPlanDetails,
  renderRadioOptions,
  replaceRegion,
  updateDisplayedPrices,
  updateOptionSelection,
} from './subscription-selector-markup.js';

/**
 * @typedef {import('./contract.js').SubscriptionEligibility} SubscriptionEligibility
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('./contract.js').SubscriptionError} SubscriptionError
 * @typedef {import('./contract.js').PurchaseType} PurchaseType
 */

/**
 * @typedef {'loading'|'unavailable'|'ready'|'error'|'hidden'} SelectorViewState
 */

/**
 * @param {HTMLElement} root
 * @param {{
 *   viewState: SelectorViewState,
 *   eligibility?: SubscriptionEligibility|null,
 *   selection?: SubscriptionSelection,
 *   error?: SubscriptionError|null,
 *   productValid?: boolean,
 *   standardPrice?: import('./contract.js').MoneyAmount|null,
 *   locale?: string,
 *   onPurchaseTypeChange?: (purchaseType: PurchaseType) => void,
 *   onPlanChange?: (planId: string) => void,
 *   onCustomOptionChange?: (code: string, value: string) => void,
 *   includeDetails?: boolean,
 * }} state
 */
export function renderSubscriptionSelector(root, state) {
  if (!root) return;

  const {
    viewState,
    eligibility = null,
    selection = { purchaseType: 'one_time' },
    error = null,
    productValid = true,
    standardPrice = null,
    locale = 'en-US',
    onPurchaseTypeChange,
    onPlanChange,
    onCustomOptionChange,
    includeDetails = true,
  } = state;

  root.classList.add('subscription-selector');
  root.dataset.state = viewState;

  if (viewState === 'hidden') {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }

  root.hidden = false;

  if (viewState !== 'ready') {
    delete root.dataset.optionsKey;
  }

  if (viewState === 'loading') {
    root.innerHTML = `
      <div class="subscription-selector__loading" role="status" aria-live="polite">
        Loading subscription options…
      </div>
    `;
    return;
  }

  if (viewState === 'error') {
    root.innerHTML = `
      <div class="subscription-selector__error" role="alert">
        <p class="subscription-selector__error-title">Subscription options unavailable</p>
        <p class="subscription-selector__error-message">
          ${error?.message || 'Unable to load subscription plans. You can still buy this product once.'}
        </p>
      </div>
    `;
    return;
  }

  if (viewState === 'unavailable' || !eligibility?.eligible) {
    root.innerHTML = `
      <div class="subscription-selector__unavailable" role="status">
        <p class="subscription-selector__unavailable-title">Subscription unavailable</p>
        <p class="subscription-selector__unavailable-message">
          ${eligibility?.ineligibilityReason || 'This product configuration is not eligible for subscription.'}
        </p>
      </div>
    `;
    return;
  }

  const purchaseType = selection.purchaseType || eligibility.defaultPurchaseType || 'one_time';
  const isSubscribe = purchaseType === 'subscription';
  const selectedPlanId = isSubscribe
    ? (selection.planId || eligibility.selectedPlanId || eligibility.plans[0]?.id)
    : undefined;
  const selectedPlan = eligibility.plans.find((plan) => plan.id === selectedPlanId) || null;
  const allowOneTime = eligibility.allowOneTime !== false;
  const renderer = eligibility.renderer === 'dropdown' ? 'dropdown' : 'radiobutton';
  const disabledAttr = productValid ? '' : 'disabled';
  const optionsKey = [
    renderer,
    allowOneTime ? ONE_TIME_VALUE : '',
    ...eligibility.plans.map((plan) => plan.id),
  ].join('\n');
  const selectedValue = isSubscribe && selectedPlan ? selectedPlan.id : ONE_TIME_VALUE;

  if (
    root.dataset.optionsKey === optionsKey
    && root.querySelector('.subscription-selector__options')
  ) {
    const fieldset = root.querySelector('.subscription-selector__fieldset');
    if (fieldset) fieldset.disabled = !productValid;
    updateOptionSelection(root, selectedValue, renderer);
    updateDisplayedPrices(root, eligibility, standardPrice, locale);
    if (includeDetails) {
      replaceRegion(
        root,
        '.subscription-selector__details',
        selectedPlan ? renderPlanDetails(selectedPlan, locale) : '',
      );
    } else {
      root.querySelector('.subscription-selector__details')?.remove();
    }
    replaceRegion(
      root,
      '.subscription-selector__custom-options',
      renderCustomOptions(eligibility, selection, isSubscribe),
    );
    bindCustomOptions(root, onCustomOptionChange);
    return;
  }

  root.dataset.optionsKey = optionsKey;
  root.dataset.renderer = renderer;
  root.innerHTML = `
    <fieldset class="subscription-selector__fieldset" ${disabledAttr}>
      <legend class="subscription-selector__legend">Purchase options</legend>
      <div
        class="subscription-selector__options"
        role="${renderer === 'dropdown' ? 'group' : 'radiogroup'}"
        aria-label="Purchase options"
      >
        ${renderer === 'dropdown'
    ? renderDropdownOptions({
      eligibility,
      selectedValue,
      allowOneTime,
      standardPrice,
      locale,
    })
    : renderRadioOptions({
      eligibility,
      selectedValue,
      allowOneTime,
      isSubscribe,
      selectedPlan,
      standardPrice,
      locale,
    })}
      </div>
    </fieldset>
    ${includeDetails && selectedPlan ? renderPlanDetails(selectedPlan, locale) : ''}
    ${renderCustomOptions(eligibility, selection, isSubscribe)}
  `;

  bindPurchaseControls(root, onPurchaseTypeChange, onPlanChange);
  bindCustomOptions(root, onCustomOptionChange);
}

/**
 * Subscription details block for a separate PDP slot (e.g. after qty).
 * @param {HTMLElement|null|undefined} root
 * @param {{
 *   plan?: import('./contract.js').SubscriptionPlan|null,
 *   locale?: string,
 *   visible?: boolean,
 * }} state
 */
export function renderSubscriptionDetails(root, state) {
  if (!root) return;
  const {
    plan = null,
    locale = 'en-US',
    visible = true,
  } = state;

  // Keep host layout class (e.g. product-details__subscription-details) for grid placement.
  root.classList.add('subscription-details');
  if (!visible || !plan) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }

  const html = renderPlanDetails(plan, locale);
  if (!html) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }

  root.hidden = false;
  root.innerHTML = html;
}

/**
 * @param {HTMLElement|null|undefined} root
 */
export function clearSubscriptionDetails(root) {
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
}

/**
 * @param {HTMLElement} root
 */
export function clearSubscriptionSelector(root) {
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  root.classList.add('subscription-selector');
  delete root.dataset.state;
  delete root.dataset.optionsKey;
  delete root.dataset.renderer;
}
