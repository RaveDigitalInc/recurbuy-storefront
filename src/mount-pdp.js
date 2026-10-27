import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import {
  fetchEligibility,
  peekConfigHasPlansForChild,
} from './adapters/storefront-adapter.js';
import { endsLabelFromPlanFacts } from './format.js';
import {
  buildEligibilityRequest,
  deriveEligibilityState,
} from './pdp-eligibility-request.js';
import {
  createProductPriceVisibility,
  resolveBundlePricedView,
  syncPdpPriceUi,
} from './pdp-price-sync.js';
import { saveSelectionForSku } from './selection-store.js';
import { clearSubscriptionPriceBox } from './subscription-price-box.js';
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
 *     visible: boolean,
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
  const { setProductPriceVisibility } = createProductPriceVisibility(productPriceRoot);

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
      visible: isVisible(),
      selectionValid: isSelectionValid(),
      productValid,
    });
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
    } = resolveBundlePricedView(eligibility, scopeEventOptions, pdpApiOptions);

    const selectedPlan = eligibilityForUi?.plans?.find(
      (plan) => String(plan.id) === String(selection.planId),
    )
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

    syncPdpPriceUi({
      viewState,
      priceRoot,
      detailsRoot,
      selection,
      standardPrice,
      standardRegularPrice,
      selectedPlan,
      setProductPriceVisibility,
    });

    notify();
  };

  const applyEligibilityResponse = (response) => {
    const next = deriveEligibilityState({
      previous: eligibility,
      selection,
      response,
    });
    eligibility = next.eligibility;
    error = next.error;
    selection = next.selection;
    viewState = next.viewState;
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
  }, eventOptions);

  // Bundle selection changes only need client recalc — not a config refetch.
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

    const { eligibilityForUi } = resolveBundlePricedView(
      eligibility,
      scopeEventOptions,
      pdpApiOptions,
    );
    const selectedPlan = eligibilityForUi?.plans?.find(
      (plan) => String(plan.id) === String(selection.planId),
    )
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

  /** False while RecurBuy has nothing to show (no plans / not loaded yet). */
  function isVisible() {
    return viewState !== 'hidden' && viewState !== 'idle';
  }

  function isSelectionValid() {
    if (!isActive() || selection.purchaseType !== 'subscription') {
      return true;
    }

    if (!selection.planId) return false;

    const requiredOptions = (eligibility?.customOptions || [])
      .filter((option) => option.required);
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
