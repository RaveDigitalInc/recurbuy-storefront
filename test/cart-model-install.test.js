import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transformCartModel } from '../src/cart-model-transformer.js';
import { RECURBUY_SUBSCRIPTION_OPTION_ID } from '../src/contract.js';
import { patchModelHook } from '../src/extend/model-config-patch.js';
import { keepModelHookAcrossSetConfig } from '../src/extend/model-hook-keep.js';

function createCartConfigStub(initial = {}) {
  let config = { ...initial };
  return {
    getConfig: () => config,
    setConfig: (next) => {
      config = next && typeof next === 'object' ? { ...next } : {};
    },
  };
}

function hasTransformer(configApi) {
  return typeof configApi.getConfig()?.models?.CartModel?.transformer === 'function';
}

describe('keepModelHookAcrossSetConfig', () => {
  it('re-attaches CartModel.transformer after initialize setConfig wipe', () => {
    const cartConfig = createCartConfigStub();
    const dispose = keepModelHookAcrossSetConfig(cartConfig, {
      attach: () => patchModelHook(cartConfig, {
        model: 'CartModel',
        hook: 'transformer',
        create: (prior) => (cart) => {
          const base = prior ? prior(cart) : undefined;
          return transformCartModel(cart) || base || null;
        },
      }),
      hasHook: () => hasTransformer(cartConfig),
    });

    assert.equal(typeof cartConfig.getConfig().models?.CartModel?.transformer, 'function');

    // Adobe cart initialize replaces config without models.
    cartConfig.setConfig({ disableGuestCart: false, locale: 'en-US' });
    assert.equal(
      typeof cartConfig.getConfig().models?.CartModel?.transformer,
      'function',
      'transformer must survive initialize setConfig wipe',
    );

    const patch = cartConfig.getConfig().models.CartModel.transformer({
      itemsV2: {
        items: [{
          uid: 'line-1',
          quantity: 1,
          prices: {
            price: { value: 23, currency: 'USD' },
            row_total: { value: 23, currency: 'USD' },
            original_item_price: { value: 23, currency: 'USD' },
            original_row_total: { value: 23, currency: 'USD' },
          },
          custom_attributes: [
            { attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '21' },
            { attribute_code: 'recurbuy_plan_label', value: 'Monthly 12 (50%)' },
            { attribute_code: 'recurbuy_plan_unit', value: '23|USD' },
          ],
          product: { uid: 'OTg=' },
        }],
      },
    });

    assert.equal(patch.items[0].recurbuy.optionId, '21');
    assert.equal(patch.items[0].recurbuy.planLabel, 'Monthly 12 (50%)');

    dispose();
    assert.equal(cartConfig.getConfig().models?.CartModel?.transformer, undefined);
  });
});
