import {
  formatDiscount,
  formatMoney,
  formatPeriod,
  getPlanDisplayPrice,
} from './format.js';

const ONE_TIME_VALUE = 'one_time';

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Merchant PDP copy may include HTML (Magento Subscribe And Save parity).
 * @param {string} value
 * @returns {string}
 */
function sanitizeMerchantHtml(value) {
  if (typeof value !== 'string' || !value.trim() || typeof DOMParser === 'undefined') {
    return escapeHtml(value || '');
  }

  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      // Strip inline handlers and javascript: URLs from merchant HTML.
      // eslint-disable-next-line no-script-url -- sanitizer removes this protocol
      if (name.startsWith('on') || val.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

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
      replaceRegion(root, '.subscription-selector__details', selectedPlan ? renderPlanDetails(selectedPlan, locale) : '');
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
      <div class="subscription-selector__options" role="${renderer === 'dropdown' ? 'group' : 'radiogroup'}" aria-label="Purchase options">
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
 * Magento-style Subscription details block for a separate PDP slot (e.g. after qty).
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
 * @param {{
 *   eligibility: SubscriptionEligibility,
 *   selectedValue: string,
 *   allowOneTime: boolean,
 *   isSubscribe: boolean,
 *   selectedPlan: import('./contract.js').SubscriptionPlan|null,
 *   standardPrice: import('./contract.js').MoneyAmount|null,
 *   locale: string,
 * }} args
 */
function renderRadioOptions({
  eligibility,
  allowOneTime,
  isSubscribe,
  selectedPlan,
  standardPrice,
  locale,
}) {
  return `
    ${allowOneTime ? renderOneTimeOption(!isSubscribe, standardPrice, locale) : ''}
    <div class="subscription-selector__subscribe">
      ${renderSubscribeAndSaveHeading(eligibility.subscribeAndSave)}
      ${eligibility.plans.map((plan) => renderPlanOption(
    plan,
    isSubscribe && plan.id === selectedPlan?.id,
    locale,
  )).join('')}
    </div>
  `;
}

/**
 * Magento dropdown renderer: one select for one-off + plans.
 * @param {{
 *   eligibility: SubscriptionEligibility,
 *   selectedValue: string,
 *   allowOneTime: boolean,
 *   standardPrice: import('./contract.js').MoneyAmount|null,
 *   locale: string,
 * }} args
 */
function renderDropdownOptions({
  eligibility,
  selectedValue,
  allowOneTime,
  standardPrice,
  locale,
}) {
  const oneTimeLabel = standardPrice
    ? `One-time purchase — ${formatMoney(standardPrice, locale)}`
    : 'One-time purchase';

  return `
    <div class="subscription-selector__subscribe subscription-selector__subscribe--dropdown">
      ${renderSubscribeAndSaveHeading(eligibility.subscribeAndSave)}
      <label class="subscription-selector__dropdown-label">
        <span class="visually-hidden">Subscription plan</span>
        <select class="subscription-selector__dropdown" name="subscription-choice" aria-label="Subscription plan">
          ${allowOneTime ? `<option value="${ONE_TIME_VALUE}" ${selectedValue === ONE_TIME_VALUE ? 'selected' : ''}>${escapeHtml(oneTimeLabel)}</option>` : ''}
          ${eligibility.plans.map((plan) => {
    const price = formatMoney(getPlanDisplayPrice(plan), locale);
    const period = formatPeriod(plan.period);
    const label = [plan.label, price, period].filter(Boolean).join(' — ');
    return `<option value="${escapeHtml(plan.id)}" ${selectedValue === plan.id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}
        </select>
      </label>
    </div>
  `;
}

/**
 * Magento SubscribeAndSaveTooltip: text + optional (?) hover tooltip from API.
 * @param {{ text?: string, tooltip?: string, isVisible?: boolean }|undefined} saveCopy
 */
function renderSubscribeAndSaveHeading(saveCopy) {
  if (!saveCopy?.isVisible || !saveCopy.text) return '';

  const tooltip = typeof saveCopy.tooltip === 'string' ? saveCopy.tooltip.trim() : '';
  return `
    <div class="subscription-selector__subscribe-and-save">
      <span class="subscription-selector__subscribe-title">${sanitizeMerchantHtml(saveCopy.text)}</span>
      ${tooltip ? `
        <span class="subscription-selector__tooltip">
          <button type="button" class="subscription-selector__tooltip-toggle" aria-label="Subscribe and save details" aria-describedby="subscription-subscribe-tooltip">?</button>
          <span id="subscription-subscribe-tooltip" class="subscription-selector__tooltip-content" role="tooltip">${sanitizeMerchantHtml(tooltip)}</span>
        </span>
      ` : ''}
    </div>
  `;
}

/**
 * @param {HTMLElement} root
 * @param {((purchaseType: PurchaseType) => void)|undefined} onPurchaseTypeChange
 * @param {((planId: string) => void)|undefined} onPlanChange
 */
function bindPurchaseControls(root, onPurchaseTypeChange, onPlanChange) {
  root.querySelectorAll('input[name="subscription-choice"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const { value } = /** @type {HTMLInputElement} */ (event.target);
      if (value === ONE_TIME_VALUE) {
        onPurchaseTypeChange?.('one_time');
        return;
      }
      onPlanChange?.(value);
    });
  });

  const select = root.querySelector('select.subscription-selector__dropdown');
  if (select) {
    select.addEventListener('change', (event) => {
      const { value } = /** @type {HTMLSelectElement} */ (event.target);
      if (value === ONE_TIME_VALUE) {
        onPurchaseTypeChange?.('one_time');
        return;
      }
      onPlanChange?.(value);
    });
  }
}

/**
 * @param {HTMLElement} root
 * @param {string} selectedValue
 * @param {'radiobutton'|'dropdown'} renderer
 */
function updateOptionSelection(root, selectedValue, renderer) {
  if (renderer === 'dropdown') {
    const select = /** @type {HTMLSelectElement|null} */ (
      root.querySelector('select.subscription-selector__dropdown')
    );
    if (select && select.value !== selectedValue) {
      select.value = selectedValue;
    }
    return;
  }

  root.querySelectorAll('input[name="subscription-choice"]').forEach((input) => {
    const checked = input.value === selectedValue;
    input.checked = checked;
    input.closest('.subscription-selector__option')?.classList.toggle('is-selected', checked);
  });
}

/**
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {string} html
 */
function replaceRegion(root, selector, html) {
  root.querySelector(selector)?.remove();
  if (!html) return;

  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const node = template.content.firstElementChild;
  if (node) root.appendChild(node);
}

/**
 * @param {HTMLElement} root
 * @param {((code: string, value: string) => void)|undefined} onCustomOptionChange
 */
function bindCustomOptions(root, onCustomOptionChange) {
  root.querySelectorAll('[data-subscription-option]').forEach((input) => {
    if (input.dataset.bound === 'true') return;
    input.dataset.bound = 'true';
    input.addEventListener('change', (event) => {
      const { target } = event;
      const control = /** @type {HTMLInputElement|HTMLSelectElement} */ (target);
      const code = control.getAttribute('data-subscription-option');
      if (code) onCustomOptionChange?.(code, control.value);
    });
  });
}

/**
 * @param {HTMLElement} root
 * @param {import('./contract.js').SubscriptionEligibility} eligibility
 * @param {import('./contract.js').MoneyAmount|null} standardPrice
 * @param {string} locale
 */
function updateDisplayedPrices(root, eligibility, standardPrice, locale) {
  const oneTime = root.querySelector('[data-subscription-price="one_time"]');
  if (oneTime) oneTime.textContent = formatMoney(standardPrice, locale);

  eligibility.plans.forEach((plan) => {
    const priceNode = root.querySelector(`[data-subscription-price="${CSS.escape(plan.id)}"]`);
    if (priceNode) priceNode.textContent = formatMoney(getPlanDisplayPrice(plan), locale);
    const savingNode = root.querySelector(`[data-subscription-saving="${CSS.escape(plan.id)}"]`);
    if (savingNode) savingNode.textContent = formatDiscount(plan.discount);
  });
}

/**
 * @param {boolean} checked
 * @param {import('./contract.js').MoneyAmount|null} standardPrice
 * @param {string} locale
 * @returns {string}
 */
function renderOneTimeOption(checked, standardPrice, locale) {
  const priceLabel = formatMoney(standardPrice, locale);

  return `
    <label class="subscription-selector__option ${checked ? 'is-selected' : ''}">
      <input
        class="subscription-selector__radio"
        type="radio"
        name="subscription-choice"
        value="${ONE_TIME_VALUE}"
        ${checked ? 'checked' : ''}
      />
      <span class="subscription-selector__option-body">
        <span class="subscription-selector__option-title">One-time purchase</span>
        <span class="subscription-selector__option-caption">Buy once</span>
      </span>
      <span class="subscription-selector__option-price" data-subscription-price="one_time">${priceLabel}</span>
    </label>
  `;
}

/**
 * @param {import('./contract.js').SubscriptionPlan} plan
 * @param {boolean} checked
 * @param {string} locale
 * @returns {string}
 */
function renderPlanOption(plan, checked, locale) {
  const price = getPlanDisplayPrice(plan);
  const priceLabel = formatMoney(price, locale);
  const periodLabel = formatPeriod(plan.period);
  const savingLabel = formatDiscount(plan.discount);

  return `
    <label class="subscription-selector__option ${checked ? 'is-selected' : ''}">
      <input
        class="subscription-selector__radio"
        type="radio"
        name="subscription-choice"
        value="${escapeHtml(plan.id)}"
        ${checked ? 'checked' : ''}
      />
      <span class="subscription-selector__option-body">
        <span class="subscription-selector__option-title">${escapeHtml(plan.label)}</span>
        ${periodLabel ? `<span class="subscription-selector__option-caption">${escapeHtml(periodLabel)}</span>` : ''}
      </span>
      <span class="subscription-selector__option-meta">
        <span class="subscription-selector__option-price" data-subscription-price="${escapeHtml(plan.id)}">${priceLabel}</span>
        ${savingLabel ? `<span class="subscription-selector__option-saving" data-subscription-saving="${escapeHtml(plan.id)}">${escapeHtml(savingLabel)}</span>` : ''}
      </span>
    </label>
  `;
}

/**
 * @param {import('./contract.js').SubscriptionPlan} plan
 * @param {string} locale
 * @returns {string}
 */
/**
 * Magento {@code aw-sarp2-subscription-details}: under the plan selector, only when a
 * subscription option is selected (one-off hides the block).
 * @param {import('./contract.js').SubscriptionPlan} plan
 * @param {string} locale
 * @returns {string}
 */
function renderPlanDetails(plan, locale) {
  /** @type {Array<{ label: string, value: string }>} */
  let rows = [];

  if (plan.facts?.length) {
    rows = plan.facts
      .filter((fact) => fact?.label && fact?.value)
      .map((fact) => ({ label: String(fact.label), value: String(fact.value) }));
  } else {
    const periodLabel = formatPeriod(plan.period);
    const regular = plan.prices?.regular;
    const initial = plan.prices?.initial;
    const displayPrice = getPlanDisplayPrice(plan);

    if (initial && regular && initial.value !== regular.value) {
      rows.push({
        label: 'First payment',
        value: `${formatMoney(initial, locale)}, then ${formatMoney(regular, locale)} ${periodLabel}`.trim(),
      });
    } else if (displayPrice && periodLabel) {
      rows.push({
        label: 'Regular payment',
        value: `${formatMoney(displayPrice, locale)} ${periodLabel}`.trim(),
      });
    }

    if (plan.trial) {
      rows.push({
        label: 'Trial',
        value: `${plan.trial.value}-${plan.trial.unit}`,
      });
    }

    if (plan.description) {
      rows.push({ label: 'Details', value: plan.description });
    }
  }

  if (!rows.length) return '';

  // Magento template: .block-title + .details-field / .details-value rows
  return `
    <div class="subscription-selector__details" data-role="subscription-details">
      <div class="subscription-selector__details-title">Subscription details</div>
      <ul class="subscription-selector__details-list" data-role="subscription-details-list">
        ${rows.map((row) => `
          <li class="subscription-selector__details-item">
            <div class="subscription-selector__details-field">${escapeHtml(row.label)}</div>
            <div class="subscription-selector__details-value">${escapeHtml(row.value)}</div>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

/**
 * @param {SubscriptionEligibility} eligibility
 * @param {SubscriptionSelection} selection
 * @param {boolean} isSubscribe
 * @returns {string}
 */
function renderCustomOptions(eligibility, selection, isSubscribe) {
  const options = eligibility.customOptions || [];
  if (!options.length || !isSubscribe) return '';

  return `
    <div class="subscription-selector__custom-options">
      <p class="subscription-selector__custom-options-title">Subscription options</p>
      ${options.map((option) => renderCustomOption(
    option,
    selection.customOptionValues?.[option.code] || '',
    isSubscribe,
  )).join('')}
    </div>
  `;
}

/**
 * @param {import('./contract.js').SubscriptionCustomOption} option
 * @param {string} value
 * @param {boolean} isSubscribe
 * @returns {string}
 */
function renderCustomOption(option, value, isSubscribe) {
  const requiredMark = option.required ? ' *' : '';
  if (option.type === 'select') {
    return `
      <label class="subscription-selector__custom-option">
        <span class="subscription-selector__custom-option-label">${escapeHtml(option.label)}${requiredMark}</span>
        <select
          class="subscription-selector__custom-option-control"
          data-subscription-option="${escapeHtml(option.code)}"
          ${isSubscribe ? '' : 'disabled'}
          ${option.required ? 'required' : ''}
        >
          <option value="">Select…</option>
          ${(option.options || []).map((entry) => `
            <option value="${escapeHtml(entry.value)}" ${value === entry.value ? 'selected' : ''}>
              ${escapeHtml(entry.label)}
            </option>
          `).join('')}
        </select>
      </label>
    `;
  }

  return `
    <label class="subscription-selector__custom-option">
      <span class="subscription-selector__custom-option-label">${escapeHtml(option.label)}${requiredMark}</span>
      <input
        class="subscription-selector__custom-option-control"
        type="${option.type === 'date' ? 'date' : 'text'}"
        data-subscription-option="${escapeHtml(option.code)}"
        value="${escapeHtml(value)}"
        ${isSubscribe ? '' : 'disabled'}
        ${option.required ? 'required' : ''}
      />
    </label>
  `;
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
