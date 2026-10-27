import {
  formatDiscount,
  formatMoney,
  formatPeriod,
  getPlanDisplayPrice,
} from './format.js';
import { escapeHtml, sanitizeMerchantHtml } from './helpers/dom-html.js';

export const ONE_TIME_VALUE = 'one_time';

/**
 * @typedef {import('./contract.js').SubscriptionEligibility} SubscriptionEligibility
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('./contract.js').PurchaseType} PurchaseType
 * @typedef {import('./contract.js').SubscriptionPlan} SubscriptionPlan
 * @typedef {import('./contract.js').MoneyAmount} MoneyAmount
 */

/**
 * @param {{
 *   eligibility: SubscriptionEligibility,
 *   selectedValue: string,
 *   allowOneTime: boolean,
 *   isSubscribe: boolean,
 *   selectedPlan: SubscriptionPlan|null,
 *   standardPrice: MoneyAmount|null,
 *   locale: string,
 * }} args
 */
export function renderRadioOptions({
  eligibility,
  allowOneTime,
  isSubscribe,
  selectedPlan,
  standardPrice,
  locale,
}) {
  const plansHtml = eligibility.plans.map((plan) => renderPlanOption(
    plan,
    isSubscribe && plan.id === selectedPlan?.id,
    locale,
  )).join('');
  return `
    ${allowOneTime ? renderOneTimeOption(!isSubscribe, standardPrice, locale) : ''}
    <div class="subscription-selector__subscribe">
      ${renderSubscribeAndSaveHeading(eligibility.subscribeAndSave)}
      ${plansHtml}
    </div>
  `;
}

/**
 * @param {{
 *   eligibility: SubscriptionEligibility,
 *   selectedValue: string,
 *   allowOneTime: boolean,
 *   standardPrice: MoneyAmount|null,
 *   locale: string,
 * }} args
 */
export function renderDropdownOptions({
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

/** @param {{ text?: string, tooltip?: string, isVisible?: boolean }|undefined} saveCopy */
export function renderSubscribeAndSaveHeading(saveCopy) {
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
 * @param {boolean} checked
 * @param {MoneyAmount|null} standardPrice
 * @param {string} locale
 * @returns {string}
 */
export function renderOneTimeOption(checked, standardPrice, locale) {
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
 * @param {SubscriptionPlan} plan
 * @param {boolean} checked
 * @param {string} locale
 * @returns {string}
 */
export function renderPlanOption(plan, checked, locale) {
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
 * Subscription details under the plan selector (hidden for one-off).
 * @param {SubscriptionPlan} plan
 * @param {string} locale
 * @returns {string}
 */
export function renderPlanDetails(plan, locale) {
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
export function renderCustomOptions(eligibility, selection, isSubscribe) {
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
export function renderCustomOption(option, value, isSubscribe) {
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
 * @param {string} selectedValue
 * @param {'radiobutton'|'dropdown'} renderer
 */
export function updateOptionSelection(root, selectedValue, renderer) {
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
 * @param {SubscriptionEligibility} eligibility
 * @param {MoneyAmount|null} standardPrice
 * @param {string} locale
 */
export function updateDisplayedPrices(root, eligibility, standardPrice, locale) {
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
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {string} html
 */
export function replaceRegion(root, selector, html) {
  root.querySelector(selector)?.remove();
  if (!html) return;

  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const node = template.content.firstElementChild;
  if (node) root.appendChild(node);
}

/**
 * @param {HTMLElement} root
 * @param {((purchaseType: PurchaseType) => void)|undefined} onPurchaseTypeChange
 * @param {((planId: string) => void)|undefined} onPlanChange
 */
export function bindPurchaseControls(root, onPurchaseTypeChange, onPlanChange) {
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
 * @param {((code: string, value: string) => void)|undefined} onCustomOptionChange
 */
export function bindCustomOptions(root, onCustomOptionChange) {
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
