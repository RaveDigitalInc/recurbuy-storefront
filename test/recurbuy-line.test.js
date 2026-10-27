import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from '../src/contract.js';
import {
  hasRecurbuyLines,
  isRecurbuyLine,
  isSafeSubscriptionStampTarget,
  lineOptionId,
  readItemAttributes,
  recurbuyLineUids,
} from '../src/recurbuy-line.js';
import {
  planRowPaint,
  resolveCartPaintScope,
  rowUidFromTestId,
} from '../src/cart-ui-scope.js';

const attr = (code, value) => ({ attribute_code: code, value });
const ours = (uid) => ({ uid, custom_attributes: [attr(RECURBUY_SUBSCRIPTION_OPTION_ID, '14')] });
const native = (uid) => ({ uid, custom_attributes: [attr('color_family', 'Blue')] });

describe('isRecurbuyLine', () => {
  it('recognises the option id marker and the optimistic plan unit', () => {
    assert.equal(isRecurbuyLine(ours('a')), true);
    assert.equal(isRecurbuyLine({ custom_attributes: [attr(RECURBUY_PLAN_UNIT, '9.5|USD')] }), true);
  });

  it('recognises a mapped CartModel line by its recurbuy bag', () => {
    assert.equal(isRecurbuyLine({ recurbuy: { optionId: '14' } }), true);
    assert.equal(isRecurbuyLine({ recurbuy: { optionId: null, planUnit: { value: 1 } } }), true);
    assert.equal(isRecurbuyLine({ recurbuy: { optionId: null, planUnit: null } }), false);
  });

  it('rejects host lines, empty markers and the zero option id', () => {
    assert.equal(isRecurbuyLine(native('a')), false);
    assert.equal(isRecurbuyLine({ uid: 'a' }), false);
    assert.equal(isRecurbuyLine(null), false);
    assert.equal(isRecurbuyLine({ custom_attributes: [attr(RECURBUY_SUBSCRIPTION_OPTION_ID, '0')] }), false);
    assert.equal(isRecurbuyLine({ custom_attributes: [attr(RECURBUY_PLAN_UNIT, 'junk')] }), false);
  });
});

describe('readItemAttributes / lineOptionId', () => {
  it('never exposes attributes owned by other modules', () => {
    assert.deepEqual(
      readItemAttributes({
        custom_attributes: [attr('color_family', 'Blue'), attr(RECURBUY_SUBSCRIPTION_OPTION_ID, '14')],
      }),
      [{ code: RECURBUY_SUBSCRIPTION_OPTION_ID, value: '14' }],
    );
    assert.deepEqual(readItemAttributes(native('a')), []);
  });

  it('reads the option id from the marker or the bag', () => {
    assert.equal(lineOptionId(ours('a')), '14');
    assert.equal(lineOptionId({ recurbuy: { optionId: '7' } }), '7');
    assert.equal(lineOptionId(native('a')), '');
  });
});

describe('cart ownership', () => {
  it('detects carts and uids that carry RecurBuy lines', () => {
    assert.equal(hasRecurbuyLines([native('a'), native('b')]), false);
    assert.equal(hasRecurbuyLines({ itemsV2: { items: [native('a'), ours('b')] } }), true);
    assert.equal(hasRecurbuyLines(null), false);
    assert.deepEqual([...recurbuyLineUids([native('a'), ours('b')])], ['b']);
  });

  it('allows finalize to stamp only a new uid or an existing RecurBuy line', () => {
    const before = { items: [native('old'), ours('sub')] };

    assert.equal(isSafeSubscriptionStampTarget(before, 'new'), true);
    assert.equal(isSafeSubscriptionStampTarget(before, 'sub'), true);
    assert.equal(isSafeSubscriptionStampTarget(before, 'old'), false);
    assert.equal(isSafeSubscriptionStampTarget(null, 'new'), true);
    assert.equal(isSafeSubscriptionStampTarget(before, ''), false);
  });

  it('trusts the add response when the pre-add cache has no marker', () => {
    const before = { items: [native('old'), { uid: 'sub', sku: 'Configurable-black-L' }] };
    const after = { itemsV2: { items: [native('old'), ours('sub')] } };

    assert.equal(isSafeSubscriptionStampTarget(before, 'sub', after), true);
    assert.equal(isSafeSubscriptionStampTarget(before, 'old', after), false);
  });
});

describe('cart UI scope', () => {
  it('is inactive for a cart without RecurBuy lines', () => {
    const scope = resolveCartPaintScope([native('a')]);

    assert.equal(scope.active, false);
    assert.equal(planRowPaint(scope, 'a', { purchaseType: 'subscription' }), 'clear');
  });

  it('paints only rows of RecurBuy lines that have subscription details', () => {
    const scope = resolveCartPaintScope({ items: [native('a'), ours('b'), ours('c')] });
    const details = { purchaseType: 'subscription' };

    assert.equal(scope.active, true);
    assert.equal(planRowPaint(scope, 'a', details), 'clear', 'host row never painted');
    assert.equal(planRowPaint(scope, 'b', details), 'paint');
    assert.equal(planRowPaint(scope, 'c', null), 'clear', 'no details yet');
    assert.equal(planRowPaint(scope, '', details), 'clear', 'row without a uid');
    assert.equal(planRowPaint(scope, 'zzz', details), 'clear', 'row of an unknown line');
  });

  it('reads the line uid from the cart drop-in row test id only', () => {
    assert.equal(rowUidFromTestId('cart-list-item-entry-abc=='), 'abc==');
    assert.equal(rowUidFromTestId('order-summary-item'), '');
    assert.equal(rowUidFromTestId(null), '');
  });
});
