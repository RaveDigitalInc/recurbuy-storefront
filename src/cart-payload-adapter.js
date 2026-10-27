import { endsLabelFromPlanFacts } from './format.js';
import {
  isHiddenCartLineOptionUid,
  withoutHiddenCartLineEnteredOptions,
} from './helpers/cart-line-option-data.js';
import { saveSelectionForSku } from './selection-store.js';

/**
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('@dropins/storefront-pdp/data/models/values-model').ValuesModel} ValuesModel
 * @typedef {{ uid: string, value: string }} EnteredOption
 */

/**
 * @param {unknown} enteredOptions
 * @returns {EnteredOption[]}
 */
function asEnteredOptionsList(enteredOptions) {
  if (Array.isArray(enteredOptions)) {
    return enteredOptions
      .filter((option) => option && typeof option === 'object' && option.uid)
      .map((option) => ({
        uid: String(option.uid),
        value: String(option.value ?? ''),
      }));
  }

  if (enteredOptions && typeof enteredOptions === 'object') {
    return Object.entries(enteredOptions).map(([uid, value]) => ({
      uid,
      value: String(value ?? ''),
    }));
  }

  return [];
}

/**
 * @param {EnteredOption[]} list
 * @param {{ uid: string, value: string }|null|undefined} cartLineEntered
 * @returns {EnteredOption[]}
 */
function withCartLineEnteredOption(list, cartLineEntered) {
  if (!cartLineEntered?.uid || !cartLineEntered?.value) {
    return list;
  }
  const uid = String(cartLineEntered.uid).trim();
  const value = String(cartLineEntered.value);
  if (!uid || !value) return list;
  const withoutPrior = list.filter((option) => option.uid !== uid);
  return [...withoutPrior, { uid, value }];
}

/**
 * @param {EnteredOption[]} list
 * @param {string|null|undefined} cartLineUid
 * @returns {EnteredOption[]}
 */
function withoutCartLineEnteredOption(list, cartLineUid) {
  const uid = typeof cartLineUid === 'string' ? cartLineUid.trim() : '';
  if (!uid) {
    return list.filter((option) => !isHiddenCartLineOptionUid(option.uid));
  }
  return list.filter(
    (option) => option.uid !== uid && !isHiddenCartLineOptionUid(option.uid),
  );
}

/**
 * Prepares PDP cart item payloads for add-to-cart.
 *
 * Subscription identity for AccS line merge uses catalog field entered_options
 * ({@code cartLineOption.uid} + server {@code planOptions[].cartLineValue}).
 * Presentation attrs are still stamped after add via finalize.
 */
export const CartPayloadAdapter = {
  /**
   * @param {ValuesModel|null|undefined} configurationValues
   * @param {SubscriptionSelection|null|undefined} selection
   * @param {{
   *   parentSku?: string,
   *   selectedPlan?: import('./contract.js').SubscriptionPlan,
   *   planOptions?: Record<string, unknown>|null,
   *   cartLineEnteredOption?: { uid: string, value: string }|null,
   *   cartLineOptionUid?: string|null,
   * }} [options]
   * @returns {ValuesModel & { parentSku?: string, enteredOptions?: EnteredOption[] }}
   */
  enrich(configurationValues, selection, options = {}) {
    if (!configurationValues) {
      throw new Error('Product configuration values are required.');
    }

    const { sku } = configurationValues;
    const { parentSku: valuesParentSku } = /** @type {{ parentSku?: string }} */ (
      configurationValues
    );
    const parentSku = options.parentSku || valuesParentSku;
    const base = { ...configurationValues };
    let enteredOptions = withoutHiddenCartLineEnteredOptions(
      asEnteredOptionsList(configurationValues.enteredOptions),
    );

    if (parentSku && parentSku !== sku) {
      base.parentSku = parentSku;
    }

    if (!selection || selection.purchaseType === 'one_time') {
      saveSelectionForSku(sku, { purchaseType: 'one_time' });
      if (parentSku && parentSku !== sku) {
        saveSelectionForSku(parentSku, { purchaseType: 'one_time' });
      }
      enteredOptions = withoutCartLineEnteredOption(
        enteredOptions,
        options.cartLineOptionUid || options.cartLineEnteredOption?.uid,
      );
      if (enteredOptions.length) {
        base.enteredOptions = enteredOptions;
      } else {
        delete base.enteredOptions;
      }
      return base;
    }

    if (!selection.planId) {
      throw new Error('Subscription plan ID is required for subscription purchase.');
    }

    const plan = options.selectedPlan;
    const endsLabel = plan ? endsLabelFromPlanFacts(plan.facts) : '';
    const enrichedSelection = {
      ...selection,
      planSnapshot:
        selection.planSnapshot
        || (plan
          ? {
            planLabel: plan.label,
            period: plan.period,
            price: plan.prices?.initial || plan.prices?.regular,
            ...(endsLabel ? { endsLabel } : {}),
          }
          : undefined),
    };

    saveSelectionForSku(sku, enrichedSelection);

    enteredOptions = withCartLineEnteredOption(
      enteredOptions,
      options.cartLineEnteredOption,
    );

    if (enteredOptions.length) {
      base.enteredOptions = enteredOptions;
    } else {
      delete base.enteredOptions;
    }

    return base;
  },
};
