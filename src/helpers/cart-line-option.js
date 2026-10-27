/**
 * AccS cart-line Subscription field option: PDP hide (by uid) + ATC helpers.
 */

import { events } from '@dropins/tools/event-bus.js';
import {
  config as pdpConfig,
  setProductConfigurationValues,
} from '@dropins/storefront-pdp/api.js';
import {
  cartLineValueFromPlanOptions,
  filterHiddenCartLineOptions,
  isHiddenCartLineOptionUid,
  readCartLineOption,
  rememberHiddenCartLineUid,
  resolveCartLineEnteredOption,
  withoutHiddenCartLineEnteredOptions,
} from './cart-line-option-data.js';
import { patchModelHook } from '../extend/model-config-patch.js';

export {
  cartLineValueFromPlanOptions,
  filterHiddenCartLineOptions,
  isHiddenCartLineOptionUid,
  readCartLineOption,
  resolveCartLineEnteredOption,
  withoutHiddenCartLineEnteredOptions,
};

/**
 * Remember hide-uid from subscription-config and refresh PDP options if needed.
 *
 * @param {Record<string, unknown>|null|undefined} config
 */
export function rememberCartLineOptionFromConfig(config) {
  const cartLine = readCartLineOption(config);
  if (!cartLine) return;
  if (!cartLine.hide) return;
  if (isHiddenCartLineOptionUid(cartLine.uid)) return;
  rememberHiddenCartLineUid(cartLine.uid);
  applyHiddenCartLineOptionsToPdp();
}

/**
 * Register Adobe PDP optionsTransformer so ProductOptions never paints the field.
 * The host's own optionsTransformer stays in the chain.
 *
 * @returns {() => void} dispose — restores the previous optionsTransformer
 */
export function installCartLineOptionPdpHide() {
  return patchModelHook(pdpConfig, {
    model: 'ProductOptions',
    hook: 'optionsTransformer',
    create: (prior) => (options) => {
      const base = prior ? prior(options) : options;
      return filterHiddenCartLineOptions(base);
    },
    passThrough: (options) => options,
  });
}

/**
 * Drop hidden uids from the live pdp/data + configuration values model.
 *
 * @param {{ scope?: string }} [options]
 */
export function applyHiddenCartLineOptionsToPdp(options = {}) {
  if (typeof events?.lastPayload !== 'function') {
    return;
  }

  const scopeOptions = options.scope ? { scope: options.scope } : undefined;
  const product = events.lastPayload('pdp/data', scopeOptions);
  if (product && Array.isArray(product.options)) {
    const nextOptions = filterHiddenCartLineOptions(product.options);
    if (nextOptions && nextOptions.length !== product.options.length) {
      events.emit('pdp/data', { ...product, options: nextOptions }, scopeOptions);
    }
  }

  try {
    // Filter from updater `prev` only — never from a getProductConfigurationValues
    // snapshot. Async subscription-config used to overwrite Color/Size UIDs the
    // shopper had already picked (empty/stale snapshot → “choose options”).
    setProductConfigurationValues((prev) => {
      if (!prev || typeof prev !== 'object') return prev;

      let changed = false;
      const next = { ...prev };

      if (Array.isArray(prev.optionsUIDs)) {
        const filtered = prev.optionsUIDs.filter(
          (uid) => !isHiddenCartLineOptionUid(uid),
        );
        if (filtered.length !== prev.optionsUIDs.length) {
          next.optionsUIDs = filtered;
          changed = true;
        }
      }

      // Only entries carrying a hidden uid are removed; the rest of the host's
      // entered options (including shapes this helper does not know) stay as is.
      if (Array.isArray(prev.enteredOptions)
        && prev.enteredOptions.some((option) => isHiddenCartLineOptionUid(option?.uid))) {
        const filteredEntered = prev.enteredOptions
          .filter((option) => !isHiddenCartLineOptionUid(option?.uid));
        if (filteredEntered.length) {
          next.enteredOptions = filteredEntered;
        } else {
          delete next.enteredOptions;
        }
        changed = true;
      }

      return changed ? next : prev;
    }, scopeOptions);
  } catch {
    // PDP may not be initialized on cart-only pages.
  }
}
