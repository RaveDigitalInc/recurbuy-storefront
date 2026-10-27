import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  normalizeGraphqlCartData,
  paintOptimisticPlanPricesOnGraphqlCart,
} from '../src/cart-raw-normalizer.js';
import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from '../src/contract.js';
import {
  rememberHiddenCartLineUid,
  resetCartLineOptionHideStateForTests,
} from '../src/helpers/cart-line-option-data.js';

const money = (value) => ({ value, currency: 'USD' });

function addResponseCart() {
  return {
    prices: {
      subtotal_excluding_tax: money(45),
      subtotal_including_tax: money(45),
      grand_total: money(45),
      grand_total_excluding_tax: money(45),
    },
    itemsV2: {
      items: [{
        uid: 'line-1',
        quantity: 1,
        prices: {
          price: money(45),
          row_total: money(45),
          original_item_price: money(45),
          original_row_total: money(45),
        },
        customizable_options: [
          { label: 'Subscription', values: [{ value: 'Monthly 12 (50%) [#14]' }] },
          { label: 'Engraving', values: [{ value: 'Hi' }] },
        ],
      }],
    },
  };
}

const labels = (item) => item.customizable_options.map((option) => option.label);

const marker = (optionId) => ({ attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: optionId });

describe('paintOptimisticPlanPricesOnGraphqlCart', () => {
  it('paints the plan unit on every field the drop-in reads', () => {
    const cart = addResponseCart();
    paintOptimisticPlanPricesOnGraphqlCart(cart, [{ uid: 'line-1', planUnit: money(22.5) }]);
    const { prices } = cart.itemsV2.items[0];

    assert.equal(prices.price.value, 22.5);
    assert.equal(prices.original_item_price.value, 22.5);
    assert.equal(prices.row_total.value, 22.5);
    assert.equal(prices.original_row_total.value, 22.5);
  });

  it('keeps the cart subtotal and grand totals in step with the lines', () => {
    const cart = addResponseCart();
    paintOptimisticPlanPricesOnGraphqlCart(cart, [{ uid: 'line-1', planUnit: money(22.5) }]);

    assert.equal(cart.prices.subtotal_excluding_tax.value, 22.5);
    assert.equal(cart.prices.grand_total.value, 22.5);
    assert.equal(cart.prices.grand_total_excluding_tax.value, 22.5);
  });

  it('removes only the merge option from the customizable options', () => {
    const cart = addResponseCart();
    paintOptimisticPlanPricesOnGraphqlCart(cart, [{
      uid: 'line-1',
      planUnit: money(22.5),
      optionId: '14',
    }]);

    assert.deepEqual(labels(cart.itemsV2.items[0]), ['Engraving']);
  });

  it('stamps plan markers onto custom_attributes for the transformer', () => {
    const cart = addResponseCart();
    paintOptimisticPlanPricesOnGraphqlCart(cart, [{
      uid: 'line-1',
      planUnit: money(22.5),
      optionId: '14',
    }]);
    const attrs = cart.itemsV2.items[0].custom_attributes;

    assert.equal(
      attrs.find((entry) => entry.attribute_code === RECURBUY_PLAN_UNIT)?.value,
      '22.5|USD',
    );
    assert.equal(
      attrs.find((entry) => entry.attribute_code === RECURBUY_SUBSCRIPTION_OPTION_ID)?.value,
      '14',
    );
  });

  it('leaves lines without a plan unit untouched', () => {
    const cart = addResponseCart();
    paintOptimisticPlanPricesOnGraphqlCart(cart, [{ uid: 'line-1', planUnit: null }]);

    assert.equal(cart.itemsV2.items[0].prices.price.value, 45);
    assert.equal(cart.prices.subtotal_excluding_tax.value, 45);
  });
});

describe('normalizeGraphqlCartData', () => {
  it('strips the merge option on every cart response for a marked line', () => {
    const cart = addResponseCart();
    cart.itemsV2.items[0].custom_attributes = [marker('14')];
    const data = { cart };
    normalizeGraphqlCartData(data);

    assert.deepEqual(labels(data.cart.itemsV2.items[0]), ['Engraving']);
  });

  it('paints optimistic lines when provided', () => {
    const data = { addProductsToCart: { cart: addResponseCart() } };
    normalizeGraphqlCartData(data, {
      optimisticLines: [{ uid: 'line-1', planUnit: money(22.5), optionId: '14' }],
    });

    assert.equal(
      data.addProductsToCart.cart.itemsV2.items[0].prices.price.value,
      22.5,
    );
  });

  it('does not treat itemsV2 as a second cart when painting totals', () => {
    const cart = addResponseCart();
    const data = { cart };
    normalizeGraphqlCartData(data, {
      optimisticLines: [{ uid: 'line-1', planUnit: money(22.5) }],
    });

    // itemsV2 alone has no prices — a double collect would leave cart.prices
    // catalog while only mutating the inner wrapper.
    assert.equal(data.cart.prices.subtotal_excluding_tax.value, 22.5);
    assert.equal(data.cart.itemsV2.prices, undefined);
  });
});

describe('normalizeGraphqlCartData isolation', () => {
  beforeEach(() => resetCartLineOptionHideStateForTests());

  const lineWith = (overrides) => ({
    uid: 'line-1',
    quantity: 1,
    prices: { price: money(10) },
    ...overrides,
  });
  const normalize = (item, options) => {
    const data = { cart: { itemsV2: { items: [item] } } };
    normalizeGraphqlCartData(data, options);
    return item;
  };

  it('keeps a host option titled Subscription on a line without our marker', () => {
    const options = [{ label: 'Subscription', values: [{ value: 'Gold plan' }] }];
    const item = normalize(lineWith({ customizable_options: options }));

    assert.equal(item.customizable_options, options);
    assert.deepEqual(labels(item), ['Subscription']);
  });

  it('keeps a host value ending with [#5] on a line without our marker', () => {
    const item = normalize(lineWith({
      customizable_options: [{ label: 'Note', values: [{ value: 'Gift [#14]' }] }],
    }));

    assert.deepEqual(labels(item), ['Note']);
  });

  it('keeps a host option on a line without our marker even if its uid is hidden', () => {
    rememberHiddenCartLineUid('uid-merge');
    const item = normalize(lineWith({
      customizable_options: [{
        customizable_option_uid: 'uid-merge',
        label: 'Subscription',
        values: [{ value: 'Monthly [#14]' }],
      }],
    }));

    assert.deepEqual(labels(item), ['Subscription']);
  });

  it('removes our merge option from a marked line, statelessly by [#id]', () => {
    const item = normalize(lineWith({
      custom_attributes: [marker('14')],
      customizable_options: [
        { label: 'Subscription', values: [{ value: 'Monthly 12 (50%) [#14]' }] },
      ],
    }));

    assert.deepEqual(item.customizable_options, []);
  });

  it('keeps a foreign option on a marked line, even with a different [#id]', () => {
    const item = normalize(lineWith({
      custom_attributes: [marker('14')],
      customizable_options: [
        { label: 'Subscription', values: [{ value: 'Monthly [#14]' }] },
        { label: 'Engraving', values: [{ value: 'Hi' }] },
        { label: 'Gift', values: [{ value: 'Card [#5]' }] },
        { label: 'Subscription', values: [{ value: 'Gold plan' }] },
      ],
    }));

    assert.deepEqual(labels(item), ['Engraving', 'Gift', 'Subscription']);
  });

  it('removes our merge option on a marked line by its known uid', () => {
    rememberHiddenCartLineUid('uid-merge');
    const item = normalize(lineWith({
      custom_attributes: [marker('14')],
      customizable_options: [
        { customizable_option_uid: 'uid-merge', label: 'Plan', values: [{ value: 'Monthly' }] },
        { customizable_option_uid: 'uid-other', label: 'Engraving', values: [{ value: 'Hi' }] },
      ],
    }));

    assert.deepEqual(labels(item), ['Engraving']);
  });

  it('only strips the optimistic line of a mixed add response', () => {
    const merge = () => ({ label: 'Subscription', values: [{ value: 'Monthly [#14]' }] });
    const native = lineWith({ uid: 'native', customizable_options: [merge()] });
    const added = lineWith({ uid: 'added', customizable_options: [merge()] });
    const data = { cart: { itemsV2: { items: [native, added] } } };
    normalizeGraphqlCartData(data, {
      optimisticLines: [{ uid: 'added', planUnit: money(5), optionId: '14' }],
    });

    assert.deepEqual(labels(native), ['Subscription']);
    assert.deepEqual(labels(added), []);
  });
});
