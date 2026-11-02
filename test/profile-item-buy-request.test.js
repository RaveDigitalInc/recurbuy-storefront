import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProfileItemBuyRequest,
  mergeProfileItemBuyRequest,
  readInitialConfigurableOptions,
  readSubscriptionOptionId,
  SUBSCRIPTION_OPTION_ID_KEY,
  MAGENTO_SUBSCRIPTION_TYPE_KEY,
} from '../src/utils/profile-item-buy-request.js';

describe('profile item buy request', () => {
  it('builds simple qty buy request', () => {
    assert.deepEqual(buildProfileItemBuyRequest(4, 2, null), {
      product: 4,
      qty: 2,
    });
  });

  it('builds configurable + bundle + grouped fields', () => {
    const buyRequest = buildProfileItemBuyRequest(10, 1, {
      product_id: 10,
      selected_product_id: 55,
      product_options: {
        configurable_item_options: [{ option_id: '93', option_value: 49 }],
        bundle_options: [{
          option_id: 1, option_qty: 2, option_selections: [7],
        }],
        grouped_options: [{ id: 3, qty: 4 }],
      },
    });

    assert.equal(buyRequest.product, 10);
    assert.deepEqual(buyRequest.super_attribute, { 93: 49 });
    assert.deepEqual(buyRequest.bundle_option, { 1: [7] });
    assert.deepEqual(buyRequest.bundle_option_qty, { 1: 2 });
    assert.deepEqual(buyRequest.super_group, { 3: 4 });
    assert.deepEqual(buyRequest.super_product_config, { product_id: 55 });
  });

  it('merges stored info_buyRequest and keeps hidden subscription option id', () => {
    const merged = mergeProfileItemBuyRequest(
      {
        aw_sarp2_subscription_type: 9,
        custom_key: 'keep',
        qty: 1,
      },
      { product: 4, qty: 3, super_attribute: { 93: 49 } },
      9,
    );

    assert.equal(merged.qty, 3);
    assert.equal(merged.custom_key, 'keep');
    assert.equal(merged[MAGENTO_SUBSCRIPTION_TYPE_KEY], 9);
    assert.equal(merged[SUBSCRIPTION_OPTION_ID_KEY], 9);
    assert.deepEqual(merged.super_attribute, { 93: 49 });
  });

  it('reads configurable options from info_buyRequest.super_attribute', () => {
    const options = readInitialConfigurableOptions({
      info_buyRequest: { super_attribute: { 93: '49', 142: 56 } },
    });
    assert.deepEqual(options, [
      { option_id: '93', option_value: 49 },
      { option_id: '142', option_value: 56 },
    ]);
  });

  it('reads subscription option id from item and info_buyRequest', () => {
    assert.equal(readSubscriptionOptionId({ subscription_option_id: 12 }), 12);
    assert.equal(readSubscriptionOptionId({
      product_options: {
        info_buyRequest: { aw_sarp2_subscription_type: 8 },
      },
    }), 8);
  });
});
