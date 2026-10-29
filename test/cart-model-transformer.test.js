import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRecurbuyBag,
  composeCartModelPatches,
  transformCartModel,
} from '../src/cart-model-transformer.js';
import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from '../src/contract.js';

const money = (value) => ({ value, currency: 'USD' });

function subscriptionGraphqlItem(overrides = {}) {
  return {
    uid: 'line-1',
    quantity: 1,
    prices: {
      price: money(22.5),
      row_total: money(22.5),
      original_item_price: money(45),
      original_row_total: money(45),
    },
    custom_attributes: [
      { attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '14' },
      { attribute_code: RECURBUY_PLAN_UNIT, value: '22.5|USD' },
    ],
    ...overrides,
  };
}

describe('transformCartModel', () => {
  it('stamps recurbuy and aligns regularPrice/total from the plan unit', () => {
    const patch = transformCartModel({
      itemsV2: { items: [subscriptionGraphqlItem()] },
    });
    const [line] = patch.items;

    assert.equal(line.recurbuy.optionId, '14');
    assert.equal(line.recurbuy.planUnit.value, 22.5);
    assert.equal(line.regularPrice.value, 22.5);
    assert.equal(line.total.value, 22.5);
  });

  it('always emits miniCartMaxItems sliced to the configured max', () => {
    const lines = [
      subscriptionGraphqlItem({ uid: 'a' }),
      subscriptionGraphqlItem({ uid: 'b' }),
      subscriptionGraphqlItem({ uid: 'c' }),
    ];
    const patch = transformCartModel(
      { itemsV2: { items: lines } },
      { miniCartMaxItemsDisplay: 2 },
    );

    assert.equal(patch.items.length, 3);
    assert.equal(patch.miniCartMaxItems.length, 2);
    assert.equal(patch.miniCartMaxItems[0].recurbuy.optionId, '14');
    assert.equal(patch.miniCartMaxItems[1].recurbuy.optionId, '14');
  });

  it('stamps catalogProductId from configured_variant uid', () => {
    const patch = transformCartModel({
      itemsV2: {
        items: [subscriptionGraphqlItem({
          configured_variant: { uid: btoa('98') },
          product: { uid: btoa('10') },
        })],
      },
    });

    assert.equal(patch.items[0].recurbuy.catalogProductId, '98');
  });

  it('returns no patch for a cart without RecurBuy lines', () => {
    const native = {
      uid: 'line-1',
      quantity: 1,
      prices: {
        price: money(45),
        row_total: money(45),
        original_item_price: money(45),
        original_row_total: money(45),
      },
      custom_attributes: [{ attribute_code: 'color_family', value: 'Blue' }],
    };

    assert.equal(transformCartModel({ itemsV2: { items: [native] } }), null);
    assert.equal(
      transformCartModel({ itemsV2: { items: [{ ...native, custom_attributes: [] }] } }),
      null,
    );
  });

  it('patches only RecurBuy lines of a mixed cart and slices only then', () => {
    const native = (uid) => ({
      uid,
      quantity: 1,
      prices: { price: money(45), row_total: money(45) },
      custom_attributes: [{ attribute_code: 'color_family', value: 'Blue' }],
    });
    const patch = transformCartModel(
      { itemsV2: { items: [native('a'), subscriptionGraphqlItem({ uid: 'b' }), native('c')] } },
      { miniCartMaxItemsDisplay: 2 },
    );

    assert.deepEqual(patch.items[0], {});
    assert.equal(patch.items[1].recurbuy.optionId, '14');
    assert.equal(patch.items[1].regularPrice.value, 22.5);
    assert.deepEqual(patch.items[2], {});
    assert.equal(patch.items.length, 3);
    assert.equal(patch.miniCartMaxItems.length, 2);
    assert.deepEqual(patch.miniCartMaxItems[0], {});
  });

  it('treats an optimistic plan-unit-only line as ours', () => {
    const patch = transformCartModel({
      itemsV2: {
        items: [subscriptionGraphqlItem({
          custom_attributes: [{ attribute_code: RECURBUY_PLAN_UNIT, value: '22.5|USD' }],
        })],
      },
    });

    assert.equal(patch.items[0].recurbuy.optionId, null);
    assert.equal(patch.items[0].recurbuy.planUnit.value, 22.5);
  });

  it('prefers stamped plan unit when AccS add response still has catalog prices', () => {
    const patch = transformCartModel({
      itemsV2: {
        items: [subscriptionGraphqlItem({
          prices: {
            price: money(46),
            row_total: money(46),
            original_item_price: money(46),
            original_row_total: money(46),
          },
          custom_attributes: [
            { attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '20' },
            { attribute_code: RECURBUY_PLAN_UNIT, value: '5.6|USD' },
          ],
          configured_variant: {
            price_range: {
              maximum_price: { regular_price: money(46), final_price: money(46) },
            },
          },
        })],
      },
    });

    assert.equal(patch.items[0].regularPrice.value, 5.6);
    assert.equal(patch.items[0].total.value, 5.6);
    assert.equal(patch.items[0].price.value, 5.6);
  });

  it('accepts CartModel-shaped items for characterization', () => {
    const patch = transformCartModel({
      items: [{
        uid: 'line-1',
        quantity: 1,
        price: money(22.5),
        rowTotal: money(22.5),
        regularPrice: money(45),
        total: money(45),
        custom_attributes: [
          { attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '14' },
        ],
      }],
    });

    assert.equal(patch.items[0].regularPrice.value, 22.5);
    assert.equal(patch.items[0].total.value, 22.5);
    assert.ok(Array.isArray(patch.miniCartMaxItems));
  });

  it('returns null for an empty cart', () => {
    assert.equal(transformCartModel(null), null);
    assert.equal(transformCartModel({ items: [] }), null);
  });
});

describe('buildRecurbuyBag', () => {
  it('keeps only RecurBuy codes in the bag, never other modules attributes', () => {
    const bag = buildRecurbuyBag(subscriptionGraphqlItem({
      custom_attributes: [
        { attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '14' },
        { attribute_code: 'color_family', value: 'Blue' },
        { attribute_code: 'gift_note', value: 'Hi' },
      ],
    }));

    assert.equal(bag.optionId, '14');
    assert.deepEqual(bag.attributes, [
      { code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '14' },
    ]);
    assert.equal('visibleAttributes' in bag, false);
  });

  it('decodes catalogProductId from product uid when no variant', () => {
    const bag = buildRecurbuyBag(subscriptionGraphqlItem({
      product: { uid: btoa('42') },
    }));
    assert.equal(bag.catalogProductId, '42');
  });
});

describe('composeCartModelPatches', () => {
  it('merges items by index instead of replacing the prior array', () => {
    const merged = composeCartModelPatches(
      { items: [{ uid: 'a', prior: true }, { uid: 'b', prior: true }] },
      { items: [{ recurbuy: { optionId: '14' } }], miniCartMaxItems: [{ recurbuy: { optionId: '14' } }] },
    );

    assert.equal(merged.items[0].prior, true);
    assert.equal(merged.items[0].recurbuy.optionId, '14');
    assert.equal(merged.items[1].prior, true);
    assert.equal(merged.miniCartMaxItems.length, 1);
  });

  it('passes the prior result through untouched when there is no RecurBuy patch', () => {
    const prior = { items: [{ uid: 'a', prior: true }] };

    assert.equal(composeCartModelPatches(prior, null), prior);
    assert.equal(composeCartModelPatches(undefined, null), undefined);
    assert.equal(composeCartModelPatches(null, null), null);
  });

  it('uses the RecurBuy patch alone when the host has no transformer', () => {
    const patch = { items: [{ recurbuy: { optionId: '14' } }], miniCartMaxItems: [] };

    assert.deepEqual(composeCartModelPatches(undefined, patch), patch);
  });
});
