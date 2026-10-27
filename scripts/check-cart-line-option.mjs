/**
 * Lightweight checks for cart-line option helpers (no drop-in runtime).
 */
import assert from 'node:assert/strict';
import {
  cartLineValueFromPlanOptions,
  filterHiddenCartLineOptions,
  isHiddenCartLineOptionUid,
  readCartLineOption,
  rememberHiddenCartLineUid,
  resetCartLineOptionHideStateForTests,
  resolveCartLineEnteredOption,
  withoutHiddenCartLineEnteredOptions,
} from '../src/helpers/cart-line-option-data.js';

resetCartLineOptionHideStateForTests();

const flatPlanOptions = {
  0: { title: 'One-time purchase', plan_id: 0 },
  42: { title: 'Every month', plan_id: 9, cartLineValue: 'Every month [#42]' },
};

assert.equal(cartLineValueFromPlanOptions(flatPlanOptions, 42), 'Every month [#42]');
assert.equal(cartLineValueFromPlanOptions(flatPlanOptions, 0), '');
assert.equal(cartLineValueFromPlanOptions(flatPlanOptions, 99), '');

const nestedPlanOptions = {
  100: {
    42: { title: 'Every month', plan_id: 9, cartLineValue: 'Every month [#42]' },
  },
};
assert.equal(cartLineValueFromPlanOptions(nestedPlanOptions, 42), 'Every month [#42]');

const config = {
  cartLineOption: {
    uid: 'Y3VzdG9tLW9wdGlvbi8x',
    hide: true,
    rootSku: 'Configurable-1',
    title: 'Subscription',
  },
  planOptions: flatPlanOptions,
};

assert.deepEqual(readCartLineOption(config), {
  uid: 'Y3VzdG9tLW9wdGlvbi8x',
  hide: true,
  rootSku: 'Configurable-1',
  title: 'Subscription',
});

assert.deepEqual(resolveCartLineEnteredOption(config, 42), {
  uid: 'Y3VzdG9tLW9wdGlvbi8x',
  value: 'Every month [#42]',
});
assert.equal(resolveCartLineEnteredOption(config, 0), null);
assert.equal(
  resolveCartLineEnteredOption({ cartLineOption: config.cartLineOption }, 42),
  null,
  'missing cartLineValue must not invent a string',
);

rememberHiddenCartLineUid(config.cartLineOption.uid);
assert.equal(isHiddenCartLineOptionUid(config.cartLineOption.uid), true);

const filtered = filterHiddenCartLineOptions([
  { id: 'color-uid', label: 'Color' },
  { id: config.cartLineOption.uid, label: 'Subscription' },
  { uid: 'size-uid', label: 'Size' },
]);
assert.deepEqual(filtered, [
  { id: 'color-uid', label: 'Color' },
  { uid: 'size-uid', label: 'Size' },
]);

assert.deepEqual(
  withoutHiddenCartLineEnteredOptions([
    { uid: config.cartLineOption.uid, value: 'Every month [#42]' },
    { uid: 'other', value: 'x' },
  ]),
  [{ uid: 'other', value: 'x' }],
);

resetCartLineOptionHideStateForTests();
assert.equal(isHiddenCartLineOptionUid(config.cartLineOption.uid), false);

console.log('check-cart-line-option: ok');
