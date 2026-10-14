import {
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from './contract.js';
import { endsLabelFromPlanFacts } from './format.js';
import { saveSelectionForSku } from './selection-store.js';

/**
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('@dropins/storefront-pdp/data/models/values-model').ValuesModel} ValuesModel
 * @typedef {{ uid: string, value: string }} EnteredOption
 */

/**
 * Normalizes input entered options into an array of EnteredOption objects.
 *
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
 * Checks whether an entered option is a legacy/fake RecurBuy subscription marker.
 * AccS rejects non-catalog option UIDs — those must never be sent.
 *
 * @param {EnteredOption} option
 * @returns {boolean}
 */
function isLegacyFakeSubscriptionMarker(option) {
  const uid = option?.uid;
  if (!uid) return false;
  if (uid === RECURBUY_SUBSCRIPTION_OPTION_ID) return true;
  try {
    return atob(uid) === `custom-option/${RECURBUY_SUBSCRIPTION_OPTION_ID}`;
  } catch {
    return false;
  }
}

/**
 * Filters out legacy RecurBuy fake markers, keeping genuine catalog options
 * (including the AccS merge-key field option).
 *
 * @param {unknown} enteredOptions
 * @returns {EnteredOption[]}
 */
function withoutLegacyFakeMarkers(enteredOptions) {
  return asEnteredOptionsList(enteredOptions).filter(
    (option) => !isLegacyFakeSubscriptionMarker(option),
  );
}

/**
 * @param {EnteredOption[]} list
 * @param {string} mergeUid
 * @param {string|number} subscriptionOptionId
 * @returns {EnteredOption[]}
 */
function withAccsCartMergeOption(list, mergeUid, subscriptionOptionId) {
  const uid = String(mergeUid || '').trim();
  if (!uid) return list;

  const value = String(subscriptionOptionId);
  const withoutPrior = list.filter((option) => option.uid !== uid);
  return [...withoutPrior, { uid, value }];
}

/**
 * Prepares PDP cart item payloads for add-to-cart.
 *
 * AccS: legacy fake RecurBuy option UIDs are stripped. A real catalog field option
 * uid from subscription-config {@code accsCartMergeOption} is appended for
 * subscription lines so Magento does not qty-merge them onto one-time lines
 * (SARP {@code addCustomOption} parity).
 */
export const CartPayloadAdapter = {
  /**
   * @param {ValuesModel|null|undefined} configurationValues
   * @param {SubscriptionSelection|null|undefined} selection
   * @param {{
   *   parentSku?: string,
   *   selectedPlan?: import('./contract.js').SubscriptionPlan,
   *   accsCartMergeOptionUid?: string|null,
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

    let cleanEnteredOptions = withoutLegacyFakeMarkers(
      configurationValues.enteredOptions,
    );

    if (parentSku && parentSku !== sku) {
      base.parentSku = parentSku;
    }

    // Save UI selection state
    if (!selection || selection.purchaseType === 'one_time') {
      saveSelectionForSku(sku, { purchaseType: 'one_time' });
      if (parentSku && parentSku !== sku) {
        saveSelectionForSku(parentSku, { purchaseType: 'one_time' });
      }
      // One-time: omit RecurBuy merge entered_option so Magento compareOptions
      // differs from a subscription line that carries the catalog field value.
      if (cleanEnteredOptions.length) {
        base.enteredOptions = cleanEnteredOptions;
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

    const optionId = selection.subscriptionOptionId || selection.optionId || selection.planId;
    cleanEnteredOptions = withAccsCartMergeOption(
      cleanEnteredOptions,
      options.accsCartMergeOptionUid,
      optionId,
    );

    if (cleanEnteredOptions.length) {
      base.enteredOptions = cleanEnteredOptions;
    } else {
      delete base.enteredOptions;
    }

    return base;
  },
};
