import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import {
  fetchEligibility,
  peekConfigHasPlansForChild,
} from './adapters/storefront-adapter.js';
import {
  calculateConfiguredTotal,
  calculateSubscriptionPrice,
  calculateTrialPrice,
  defaultSelectionState,
  extractAccsBundleOptions,
  rewriteFactMoneyAmounts,
  selectionStateFromAccsOptionUids,
} from './bundle-price.js';
import { SUBSCRIPTION_ERROR_CODES } from './contract.js';
import { endsLabelFromPlanFacts } from './format.js';
import { hideAccsCartMergeOptionElements } from './helpers/hide-accs-merge-option.js';
import { saveSelectionForSku } from './selection-store.js';
import {
  clearSubscriptionPriceBox,
  renderSubscriptionPriceBox,
} from './subscription-price-box.js';
import {
  clearSubscriptionDetails,
  clearSubscriptionSelector,
  renderSubscriptionDetails,
  renderSubscriptionSelector,
} from './subscription-selector.js';

/**
 * @typedef {import('./contract.js').SubscriptionEligibility} SubscriptionEligibility
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('./contract.js').SubscriptionError} SubscriptionError
 * @typedef {import('./contract.js').MoneyAmount} MoneyAmount
 * @typedef {import('@dropins/storefront-pdp/data/models/product-model').ProductModel} ProductModel
 * @typedef {import('@dropins/storefront-pdp/data/models/values-model').ValuesModel} ValuesModel
 */

/**
 * @typedef {Object} SubscriptionPdpController
 * @property {() => SubscriptionSelection} getSelection
 * @property {() => boolean} isSelectionValid
 * @property {() => boolean} isActive
 * @property {() => void} destroy
 */

/**
 * Mounts subscription selector + price box and reacts to PDP events.
 * @param {{
 *   selectorRoot: HTMLElement,
 *   priceRoot: HTMLElement,
 *   productPriceRoot?: HTMLElement|null,
 *   detailsRoot?: HTMLElement|null,
 *   scope?: string,
 *   initialSelection?: import('./contract.js').SubscriptionSelection,
 *   onChange?: (selection: SubscriptionSelection, meta: {
 *     active: boolean,
 *     selectionValid: boolean,
 *     productValid: boolean,
 *   }) => void,
 * }} options
 * @returns {SubscriptionPdpController}
 */
export function mountSubscriptionOnPdp({
  selectorRoot,
  priceRoot,
  productPriceRoot = null,
  detailsRoot = null,
  scope,
  initialSelection = { purchaseType: 'one_time' },
  onChange,
}) {
  /** @type {SubscriptionEligibility|null} */
  let eligibility = null;
  /** @type {SubscriptionError|null} */
  let error = null;
  /** @type {SubscriptionSelection} */
  let selection = {
    purchaseType: initialSelection?.purchaseType || 'one_time',
    planId: initialSelection?.planId || initialSelection?.subscriptionOptionId,
    customOptionValues: {
      ...(initialSelection?.customOptionValues || {}),
    },
  };
  /** @type {'idle'|'loading'|'ready'|'unavailable'|'error'|'hidden'} */
  let viewState = 'idle';
  let productValid = true;
  let requestSeq = 0;
  /** @type {string|null} */
  let lastEligibilityKey = null;
  let destroyed = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let debounceTimer = null;

  const scopeEventOptions = scope ? { scope } : undefined;
  const pdpApiOptions = scope ? { scope } : undefined;

  const notify = () => {
    const nextSelection = getSelection();
    const product = /** @type {ProductModel|null} */ (
      events.lastPayload('pdp/data', scopeEventOptions) ?? null
    );
    const sku = product?.sku;
    if (sku) {
      saveSelectionForSku(sku, nextSelection);
    }

    onChange?.(nextSelection, {
      active: isActive(),
      selectionValid: isSelectionValid(),
      productValid,
    });
  };

  const setProductPriceVisibility = (showSubscriptionPrice) => {
    if (!productPriceRoot) return;
    productPriceRoot.hidden = showSubscriptionPrice;
  };

  const getStandardPrices = () => {
    const product = /** @type {ProductModel|null} */ (
      events.lastPayload('pdp/data', scopeEventOptions) ?? null
    );
    return {
      standardPrice: toMoney(product?.prices?.final),
      standardRegularPrice: toMoney(product?.prices?.regular),
    };
  };

  /**
   * @param {import('./bundle-price.js').AccsBundleOption[]} bundleOptions
   * @returns {Record<number, number>}
   */
  const resolveBundleSelectionState = (bundleOptions) => {
    const values = /** @type {ValuesModel|null} */ (
      pdpApi.getProductConfigurationValues(pdpApiOptions)
      || events.lastPayload('pdp/values', scopeEventOptions)
      || null
    );
    const product = /** @type {ProductModel|null} */ (
      events.lastPayload('pdp/data', scopeEventOptions) ?? null
    );
    const uids = values?.optionsUIDs
      || /** @type {{ optionUIDs?: string[] }} */ (product)?.optionUIDs
      || [];
    const fromUids = selectionStateFromAccsOptionUids(
      Array.isArray(uids) ? uids : [],
    );
    if (Object.keys(fromUids).length > 0) return fromUids;

    return defaultSelectionState(bundleOptions);
  };

  /**
   * Magento bundles: AccS GraphQL priceRange is a catalog min/max, not configured
   * selection × optionPlanData. Selections come from Commerce on `pdp/data`;
   * RecurBuy only supplies percents. Recalc like Magento `bundle-options-mixin.js`.
   *
   * One-time must keep Magento final/sale selection totals (AccS shows those before
   * RecurBuy loads). Subscription % still follows isUsedAdvancedPricing (regular when
   * off) — Magento SARP mixin parity. Do not paint one-time with link/regular sum.
   */
  const resolveBundlePricedView = () => {
    const catalogPrices = getStandardPrices();
    const product = /** @type {ProductModel|null} */ (
      events.lastPayload('pdp/data', scopeEventOptions) ?? null
    );
    const useAdvanced = Boolean(eligibility?.isUsedAdvancedPricing);
    const planBundleOptions = eligibility?.productType === 'bundle'
      ? extractAccsBundleOptions(product, useAdvanced)
      : [];

    if (eligibility?.productType !== 'bundle' || !planBundleOptions.length) {
      return {
        eligibilityForUi: eligibility,
        standardPrice: catalogPrices.standardPrice,
        standardRegularPrice: catalogPrices.standardRegularPrice,
      };
    }

    const currency = eligibility.currency
      || catalogPrices.standardPrice?.currency
      || 'USD';
    const selectionState = resolveBundleSelectionState(planBundleOptions);
    // AccS already paints product.prices.final with specials for the current
    // configuration (screenshot: $375.99 before RecurBuy mounts). Selection rows
    // often only expose regular/link — do not replace AccS final with that sum.
    const oneTimeBundleOptions = useAdvanced
      ? planBundleOptions
      : extractAccsBundleOptions(product, true);
    const computedOneTimeTotal = calculateConfiguredTotal(
      oneTimeBundleOptions.length ? oneTimeBundleOptions : planBundleOptions,
      selectionState,
    );
    const regularConfiguredTotal = calculateConfiguredTotal(
      planBundleOptions,
      selectionState,
    );
    const accsFinal = catalogPrices.standardPrice;
    const accsFinalValue = accsFinal?.value;
    // When advanced pricing is off, selection rows usually only expose regular/link,
    // so computed "final" collapses to the link sum — keep AccS parent final instead.
    const childrenLackSale = !useAdvanced
      && Math.abs(computedOneTimeTotal - regularConfiguredTotal) < 0.02;
    const oneTimeTotal = (
      typeof accsFinalValue === 'number'
      && Number.isFinite(accsFinalValue)
      && accsFinalValue > 0
      && childrenLackSale
    )
      ? accsFinalValue
      : computedOneTimeTotal;

    const plans = (eligibility.plans || []).map((plan) => {
      const optionId = Number(plan.id);
      const regularValue = calculateSubscriptionPrice(
        planBundleOptions,
        selectionState,
        optionId,
        eligibility.optionPlanData,
      );
      const trialValue = calculateTrialPrice(
        planBundleOptions,
        selectionState,
        optionId,
        eligibility.optionPlanData,
      );

      /** @type {import('./contract.js').SubscriptionPlan} */
      const priced = {
        ...plan,
        prices: {
          regular: { value: regularValue, currency },
          // Prefer regular when there is no real trial;
          // $0 trialPercent must not become display initial.
          ...(trialValue != null
            && trialValue > 0
            && trialValue !== regularValue
            ? { initial: { value: trialValue, currency } }
            : {}),
        },
        facts: rewriteFactMoneyAmounts(plan.facts, regularValue, currency),
      };

      const percent = eligibility.optionPlanData?.[String(plan.id)]?.regularPercent;
      if (percent != null && Number.isFinite(percent) && percent < 100) {
        priced.discount = { type: 'percent', value: 100 - percent };
      }

      return priced;
    });

    return {
      eligibilityForUi: {
        ...eligibility,
        plans,
      },
      standardPrice: { value: oneTimeTotal, currency },
      standardRegularPrice: !useAdvanced
        && regularConfiguredTotal > oneTimeTotal + 0.009
        ? { value: regularConfiguredTotal, currency }
        : (catalogPrices.standardRegularPrice || null),
    };
  };

  const render = () => {
    if (destroyed) return;

    if (viewState === 'hidden' || viewState === 'idle') {
      clearSubscriptionSelector(selectorRoot);
      clearSubscriptionPriceBox(priceRoot);
      clearSubscriptionDetails(detailsRoot);
      setProductPriceVisibility(false);
      notify();
      return;
    }

    const {
      eligibilityForUi,
      standardPrice,
      standardRegularPrice,
    } = resolveBundlePricedView();

    const selectedPlan = eligibilityForUi?.plans?.find((plan) => plan.id === selection.planId)
      || eligibilityForUi?.plans?.[0]
      || null;
    const showDetails = viewState === 'ready'
      && selection.purchaseType === 'subscription'
      && Boolean(selectedPlan);

    renderSubscriptionSelector(selectorRoot, {
      viewState: viewState === 'ready' ? 'ready' : viewState,
      eligibility: eligibilityForUi,
      selection,
      error,
      productValid,
      standardPrice,
      // Details render in detailsRoot (after qty); keep selector free of the block.
      includeDetails: !detailsRoot,
      onPurchaseTypeChange: (purchaseType) => {
        selection = {
          ...selection,
          purchaseType,
          planId: undefined,
        };
        render();
      },
      onPlanChange: (planId) => {
        selection = {
          ...selection,
          purchaseType: 'subscription',
          planId,
        };
        render();
      },
      onCustomOptionChange: (code, value) => {
        selection = {
          ...selection,
          customOptionValues: {
            ...(selection.customOptionValues || {}),
            [code]: value,
          },
        };
        render();
      },
    });

    if (detailsRoot) {
      renderSubscriptionDetails(detailsRoot, {
        plan: showDetails ? selectedPlan : null,
        visible: showDetails,
      });
    }

    if (viewState === 'ready') {
      renderSubscriptionPriceBox(priceRoot, {
        purchaseType: selection.purchaseType,
        plan: selection.purchaseType === 'subscription' ? selectedPlan : null,
        standardPrice,
        standardRegularPrice,
      });
      setProductPriceVisibility(true);
    } else {
      clearSubscriptionPriceBox(priceRoot);
      clearSubscriptionDetails(detailsRoot);
      setProductPriceVisibility(false);
    }

    notify();
    // AccS may briefly paint the catalog merge-key field; hide it (not a shopper input).
    hideAccsCartMergeOptionElements(selectorRoot?.ownerDocument || document);
  };

  const applyEligibilityResponse = (response) => {
    if (response.error) {
      if (
        response.error.code === SUBSCRIPTION_ERROR_CODES.NOT_FOUND
        || response.error.code === SUBSCRIPTION_ERROR_CODES.NOT_ELIGIBLE
      ) {
        eligibility = null;
        error = null;
        selection = { purchaseType: 'one_time' };
        viewState = 'hidden';
        render();
        return;
      }

      eligibility = null;
      error = response.error;
      selection = { purchaseType: 'one_time' };
      viewState = 'error';
      render();
      return;
    }

    const previous = eligibility;
    eligibility = response.data || null;
    error = null;

    if (!eligibility) {
      viewState = 'hidden';
      selection = { purchaseType: 'one_time' };
      render();
      return;
    }

    // options-list can flake on slow AccS; keep merchant PDP copy / renderer from last success.
    if (previous && previous.sku === eligibility.sku) {
      eligibility = {
        ...eligibility,
        renderer: eligibility.renderer || previous.renderer,
        subscribeAndSave: eligibility.subscribeAndSave || previous.subscribeAndSave,
      };
    }

    // No plans for this config (e.g. Override=No child without options) — hide like Magento PDP.
    if (!eligibility.eligible || !eligibility.plans?.length) {
      viewState = 'hidden';
      selection = { purchaseType: 'one_time' };
      render();
      return;
    }

    const defaultPurchaseType = eligibility.allowOneTime === false
      ? 'subscription'
      : (eligibility.defaultPurchaseType || 'one_time');
    const defaultPlanId = eligibility.selectedPlanId || eligibility.plans[0].id;
    const keepPlan = eligibility.plans.some((plan) => plan.id === selection.planId);

    if (!keepPlan) {
      selection = {
        purchaseType: defaultPurchaseType,
        planId: defaultPurchaseType === 'subscription' ? defaultPlanId : undefined,
        customOptionValues: {},
      };
    } else if (
      selection.purchaseType === 'subscription'
      && eligibility.allowOneTime === false
    ) {
      selection = {
        ...selection,
        purchaseType: 'subscription',
      };
    }

    viewState = 'ready';
    render();
  };

  const refreshEligibility = async () => {
    const product = /** @type {ProductModel|null} */ (
      events.lastPayload('pdp/data', scopeEventOptions) ?? null
    );
    const values = /** @type {ValuesModel|null} */ (
      pdpApi.getProductConfigurationValues(pdpApiOptions)
      || events.lastPayload('pdp/values', scopeEventOptions)
      || null
    );

    if (!product?.sku) {
      viewState = 'hidden';
      render();
      return;
    }

    const request = buildEligibilityRequest(product, values, initialSelection);
    const eligibilityKey = [
      request.product?.externalId || request.productId || '',
      request.product?.selectedChildExternalId || '',
      request.subscriptionOptionId || '',
      request.context || '',
    ].join('|');

    // AccS emits pdp/data + pdp/values (and refine) often with the same key — skip noise.
    if (eligibilityKey === lastEligibilityKey && (viewState === 'ready' || viewState === 'hidden')) {
      return;
    }

    requestSeq += 1;
    const seq = requestSeq;
    error = null;

    // Cached config: hide without loader when this child has no plans; show loader when it does
    // (or unknown on first load). Avoids "Loading…" on Override=No empty variants.
    const knownHasPlans = peekConfigHasPlansForChild(
      request.product?.externalId || request.productId,
      request.product?.selectedChildExternalId,
    );
    if (knownHasPlans === false) {
      viewState = 'hidden';
      eligibility = null;
      selection = { purchaseType: 'one_time' };
    } else if (knownHasPlans === null) {
      viewState = 'loading';
    }
    // knownHasPlans === true: keep current UI while remap from cache (no loading flash).
    render();

    const response = await fetchEligibility(request);
    if (destroyed || seq !== requestSeq) return;
    lastEligibilityKey = eligibilityKey;
    applyEligibilityResponse(response);
  };

  const scheduleRefresh = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      refreshEligibility();
    }, 150);
  };

  const onValid = (valid) => {
    productValid = Boolean(valid);
    render();
  };

  const eventOptions = scope
    ? { eager: true, scope }
    : { eager: true };

  const dataListener = events.on('pdp/data', () => {
    scheduleRefresh();
    hideAccsCartMergeOptionElements(selectorRoot?.ownerDocument || document);
  }, eventOptions);

  // Bundle selection changes only need Magento-style client recalc — not a config refetch.
  const valuesListener = events.on('pdp/values', () => {
    if (viewState === 'ready' && eligibility?.productType === 'bundle') {
      render();
      return;
    }
    scheduleRefresh();
  }, eventOptions);

  const validListener = events.on('pdp/valid', onValid, eventOptions);

  function getSelection() {
    if (!isActive() || selection.purchaseType !== 'subscription') {
      return { purchaseType: 'one_time' };
    }

    const { eligibilityForUi } = resolveBundlePricedView();
    const selectedPlan = eligibilityForUi?.plans?.find((plan) => plan.id === selection.planId)
      || eligibilityForUi?.plans?.[0]
      || null;

    const price = selectedPlan?.prices?.initial || selectedPlan?.prices?.regular;
    const endsLabel = selectedPlan
      ? endsLabelFromPlanFacts(selectedPlan.facts)
      : '';

    return {
      purchaseType: 'subscription',
      planId: selection.planId,
      subscriptionOptionId: selection.planId,
      selectedPlan,
      planSnapshot: selectedPlan ? {
        planLabel: selectedPlan.label,
        period: selectedPlan.period,
        price,
        ...(endsLabel ? { endsLabel } : {}),
      } : undefined,
      customOptionValues: { ...(selection.customOptionValues || {}) },
    };
  }

  function isActive() {
    return viewState === 'ready' && Boolean(eligibility?.eligible);
  }

  function isSelectionValid() {
    if (!isActive() || selection.purchaseType !== 'subscription') {
      return true;
    }

    if (!selection.planId) return false;

    const requiredOptions = (eligibility?.customOptions || []).filter((option) => option.required);
    return requiredOptions.every((option) => {
      const value = selection.customOptionValues?.[option.code];
      return Boolean(value && String(value).trim());
    });
  }

  function destroy() {
    destroyed = true;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    dataListener?.off?.();
    valuesListener?.off?.();
    validListener?.off?.();
    clearSubscriptionSelector(selectorRoot);
    clearSubscriptionPriceBox(priceRoot);
    clearSubscriptionDetails(detailsRoot);
    setProductPriceVisibility(false);
  }

  return {
    getSelection,
    isSelectionValid,
    isActive,
    destroy,
  };
}

/**
 * @param {ProductModel} product
 * @param {ValuesModel|null} values
 * @param {import('./contract.js').SubscriptionSelection} [initialSelection]
 * @returns {import('./contract.js').SubscriptionEligibilityRequest & Record<string, any>}
 */
function buildEligibilityRequest(product, values, initialSelection) {
  const sku = values?.sku || product.variantSku || product.sku;
  const planId = initialSelection?.planId || initialSelection?.subscriptionOptionId;
  const isEditing = initialSelection?.purchaseType === 'subscription' || Boolean(planId);
  // Magento SARP always loads config for the configurable parent; AccS variant
  // selection sets externalId to the child — prefer externalParentId for API.
  const parentExternalId = typeof product.externalParentId === 'string'
    ? product.externalParentId.trim()
    : '';
  const childExternalId = product.externalId ? String(product.externalId) : undefined;
  const catalogExternalId = parentExternalId || childExternalId;
  const selectedChildExternalId = parentExternalId
    && childExternalId
    && parentExternalId !== childExternalId
    ? childExternalId
    : undefined;

  return {
    sku,
    productId: catalogExternalId ? Number(catalogExternalId) : undefined,
    product: {
      ...(catalogExternalId && { externalId: catalogExternalId }),
      ...(selectedChildExternalId && { selectedChildExternalId }),
    },
    ...(planId && { subscriptionOptionId: planId }),
    ...(isEditing && { context: 'edit_item' }),
  };
}

/**
 * @param {{
 *   amount?: number,
 *   currency?: string,
 *   minimumAmount?: number,
 *   maximumAmount?: number,
 * }|null|undefined} price
 * @returns {MoneyAmount|null}
 */
function toMoney(price) {
  if (!price) return null;

  let value = null;
  if (typeof price.amount === 'number') {
    value = price.amount;
  } else if (typeof price.minimumAmount === 'number') {
    value = price.minimumAmount;
  }

  if (value === null) return null;
  return {
    value,
    currency: price.currency || 'USD',
  };
}
