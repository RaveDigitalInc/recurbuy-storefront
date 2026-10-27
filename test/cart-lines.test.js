import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cartLines,
  findLineByUid,
  findLineUidBySku,
  resolveAddedLineUid,
} from '../src/cart-lines.js';

describe('cartLines', () => {
  it('reads drop-in and raw GraphQL shapes', () => {
    assert.deepEqual(cartLines({ items: [{ uid: 'a' }] }), [{ uid: 'a' }]);
    assert.deepEqual(cartLines({ itemsV2: { items: [{ uid: 'b' }] } }), [{ uid: 'b' }]);
  });

  it('prefers itemsV2 when the deprecated items page is stale or partial', () => {
    const cart = {
      items: [{ uid: 'stale' }],
      itemsV2: { items: [{ uid: 'a' }, { uid: 'b' }] },
    };
    assert.deepEqual(cartLines(cart).map((line) => line.uid), ['a', 'b']);
  });

  it('returns an empty list for missing or malformed carts', () => {
    assert.deepEqual(cartLines(null), []);
    assert.deepEqual(cartLines({ items: 'nope' }), []);
  });
});

describe('findLineByUid', () => {
  it('finds a line or returns null', () => {
    const cart = { items: [{ uid: 'a' }, { uid: 'b' }] };
    assert.equal(findLineByUid(cart, 'b')?.uid, 'b');
    assert.equal(findLineByUid(cart, 'x'), null);
    assert.equal(findLineByUid(cart, ''), null);
  });
});

describe('findLineUidBySku', () => {
  it('matches a simple line by its own sku, case-insensitively', () => {
    const cart = { items: [{ uid: 'a', sku: 'Bag-1' }, { uid: 'b', sku: 'Hat' }] };
    assert.equal(findLineUidBySku(cart, 'bag-1'), 'a');
  });

  it('matches a configurable line through its parent sku', () => {
    const cart = { items: [{ uid: 'a', sku: 'Conf-black-L', topLevelSku: 'Conf-1' }] };
    assert.equal(findLineUidBySku(cart, 'Conf-1'), 'a');
  });

  it('refuses an ambiguous parent match', () => {
    const cart = {
      items: [
        { uid: 'a', sku: 'Conf-black-L', topLevelSku: 'Conf-1' },
        { uid: 'b', sku: 'Conf-red-M', topLevelSku: 'Conf-1' },
      ],
    };
    assert.equal(findLineUidBySku(cart, 'Conf-1'), null);
  });

  it('returns null without a sku', () => {
    assert.equal(findLineUidBySku({ items: [{ uid: 'a', sku: 'x' }] }, ''), null);
  });
});

describe('resolveAddedLineUid', () => {
  it('picks the new line', () => {
    const before = { items: [{ uid: 'a', sku: 'X', quantity: 1 }] };
    const after = { items: [{ uid: 'a', sku: 'X', quantity: 1 }, { uid: 'b', sku: 'Y', quantity: 1 }] };
    assert.equal(resolveAddedLineUid(before, after, { sku: 'Y' }), 'b');
  });

  it('picks the line whose quantity grew', () => {
    const before = { items: [{ uid: 'a', sku: 'X', quantity: 1 }, { uid: 'b', sku: 'Y', quantity: 1 }] };
    const after = { items: [{ uid: 'a', sku: 'X', quantity: 1 }, { uid: 'b', sku: 'Y', quantity: 2 }] };
    assert.equal(resolveAddedLineUid(before, after, { sku: 'Y' }), 'b');
  });

  it('tells configurable variants apart by selected option uids', () => {
    const before = { items: [{ uid: 'a', quantity: 1, selectedOptionsUIDs: ['o1', 'o2'] }] };
    const after = {
      items: [
        { uid: 'a', quantity: 1, selectedOptionsUIDs: ['o1', 'o2'] },
        { uid: 'b', quantity: 1, selectedOptionsUIDs: ['o3', 'o1'] },
      ],
    };
    assert.equal(resolveAddedLineUid(before, after, { optionsUIDs: ['o1', 'o3'] }), 'b');
  });

  it('returns null when nothing changed or the cart is empty', () => {
    const cart = { items: [{ uid: 'a', quantity: 1 }] };
    assert.equal(resolveAddedLineUid(cart, cart, { sku: 'x' }), null);
    assert.equal(resolveAddedLineUid(null, { items: [] }, { sku: 'x' }), null);
  });

  it('returns null when several lines changed and none can be told apart', () => {
    const after = { items: [{ uid: 'a', quantity: 1 }, { uid: 'b', quantity: 1 }] };
    assert.equal(resolveAddedLineUid({ items: [] }, after, { sku: 'zzz' }), null);
  });

  it('prefers a brand-new uid over an existing same-SKU host line', () => {
    const before = { items: [{ uid: 'old', sku: 'Configurable-black-L', quantity: 2 }] };
    const after = {
      items: [
        { uid: 'old', sku: 'Configurable-black-L', quantity: 2 },
        { uid: 'new', sku: 'Configurable-black-L', quantity: 1 },
      ],
    };
    assert.equal(resolveAddedLineUid(before, after, { sku: 'Configurable-black-L' }), 'new');
  });

  it('reads the new line from itemsV2 when deprecated items is the host line', () => {
    const before = { items: [{ uid: 'old', sku: 'Configurable-black-L', quantity: 2 }] };
    const after = {
      items: [{ uid: 'old', sku: 'Configurable-black-L', quantity: 2 }],
      itemsV2: {
        items: [
          { uid: 'old', sku: 'Configurable-black-L', quantity: 2 },
          { uid: 'new', sku: 'Configurable-black-L', quantity: 1 },
        ],
      },
    };
    assert.equal(resolveAddedLineUid(before, after, { sku: 'Configurable-black-L' }), 'new');
  });

  it('matches a new configurable line through the parent sku', () => {
    const line = (uid, quantity) => ({
      uid,
      sku: 'Configurable-black-L',
      topLevelSku: 'Configurable-1',
      quantity,
    });
    const before = { items: [line('old', 2)] };
    const after = { items: [line('old', 2), line('new', 1)] };
    assert.equal(resolveAddedLineUid(before, after, { sku: 'Configurable-1' }), 'new');
  });
});
