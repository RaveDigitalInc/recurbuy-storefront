import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  peekCapturedQuoteMarkers,
  subscriptionMarkersNeedCatalogBackfill,
} from '../src/adapters/quote-markers-peek.js';
import { transformCartModel } from '../src/cart-model-transformer.js';
import {
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
} from '../src/contract.js';

const money = (value) => ({ value, currency: 'USD' });

describe('peekCapturedQuoteMarkers', () => {
  it('returns markers when subscription lines have catalogProductId', () => {
    const patch = transformCartModel({
      itemsV2: {
        items: [{
          uid: 'line-1',
          quantity: 1,
          product: { uid: btoa('42') },
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
        }],
      },
    });

    const items = [{
      uid: 'line-1',
      price: money(22.5),
      recurbuy: patch.items[0].recurbuy,
    }];
    const markers = peekCapturedQuoteMarkers(items);

    assert.ok(markers);
    assert.equal(markers.get('line-1')?.catalogProductId, '42');
    assert.equal(markers.get('line-1')?.optionId, '14');
  });

  it('falls through (null) when a subscription line lacks catalogProductId', () => {
    const items = [{
      uid: 'line-1',
      price: money(22.5),
      recurbuy: {
        optionId: '14',
        catalogProductId: '',
        startDate: null,
        planLabel: null,
        period: null,
        endsLabel: null,
        planUnit: { value: 22.5, currency: 'USD' },
        attributes: [],
      },
    }];

    assert.equal(peekCapturedQuoteMarkers(items), null);
    assert.equal(
      subscriptionMarkersNeedCatalogBackfill(items, new Map([['line-1', {
        optionId: '14',
        catalogProductId: '',
        unitPrice: 22.5,
        currency: 'USD',
        startDate: '',
        planLabel: '',
        period: null,
        endsLabel: '',
        stampedPlanUnit: null,
      }]])),
      true,
    );
  });

  it('does not fall through for one-time lines without catalogProductId', () => {
    const items = [{
      uid: 'line-1',
      recurbuy: {
        optionId: null,
        catalogProductId: '',
        startDate: null,
        planLabel: null,
        period: null,
        endsLabel: null,
        planUnit: null,
        attributes: [],
      },
    }];

    const markers = peekCapturedQuoteMarkers(items);
    assert.ok(markers);
    assert.equal(markers.size, 0);
  });

  it('peeks a mixed cart: host lines carry no bag and yield no marker', () => {
    const items = [
      { uid: 'host', price: money(10) },
      {
        uid: 'line-1',
        price: money(22.5),
        recurbuy: {
          optionId: '14',
          catalogProductId: '42',
          planUnit: { value: 22.5, currency: 'USD' },
          attributes: [],
        },
      },
    ];

    const markers = peekCapturedQuoteMarkers(items);
    assert.ok(markers, 'no catalog round-trip needed');
    assert.deepEqual([...markers.keys()], ['line-1']);
  });
});
