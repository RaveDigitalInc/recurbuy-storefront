import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInitialSelection,
  collectConfigureResult,
  formatSelectedVariant,
  isEditItemAvailable,
  renderEditItemForm,
  resolveProductHeading,
  resolveSwatchPresentation,
} from '../src/subscription-edit-item-ui.js';

describe('subscription edit item UI', () => {
  it('renders qty form and Update Subscription for simple item', () => {
    const html = renderEditItemForm({
      profile: {
        profile_id: 91,
        actions: {
          can_one_time_edit_product_item: true,
          items: [{ item_id: 11, is_edit_item_available: true }],
        },
      },
      item: {
        item_id: 11,
        product_id: 4,
        name: 'Coffee',
        sku: 'c1',
        qty: 2,
        product_type: 'simple',
      },
      configure: { product_id: 4, type_id: 'simple' },
      qty: 2,
      selection: {},
    });

    assert.match(html, /Edit Product/);
    assert.match(html, /Coffee/);
    assert.match(html, /name="qty"/);
    assert.match(html, /value="2"/);
    assert.match(html, /Update Subscription/);
    assert.match(html, /#rb\/detail\/91/);
    assert.doesNotMatch(html, /How would you like to apply/);
  });

  it('shows one-time modal when requested', () => {
    const html = renderEditItemForm({
      profile: {
        profile_id: 91,
        actions: {
          can_one_time_edit_product_item: true,
          items: [{ item_id: 11, is_edit_item_available: true }],
        },
      },
      item: { item_id: 11, product_id: 4, name: 'Coffee', qty: 1 },
      configure: { type_id: 'simple' },
      qty: 1,
      selection: {},
      showOneTimeModal: true,
      canOneTimeEdit: true,
    });

    assert.match(html, /How would you like to apply the changes/);
    assert.match(html, /data-recurbuy-one-time="0"/);
    assert.match(html, /data-recurbuy-one-time="1"/);
    assert.match(html, /Permanently/);
    assert.match(html, /For the next order only/);
  });

  it('renders configurable attributes from configure schema', () => {
    const html = renderEditItemForm({
      profile: {
        profile_id: 3,
        actions: { items: [{ item_id: 7, is_edit_item_available: true }] },
      },
      item: {
        item_id: 7,
        product_id: 10,
        name: 'Shirt (shirt-black)',
        sku: 'shirt-black',
        product_type: 'configurable',
      },
      configure: {
        product_id: 10,
        name: 'Shirt',
        type_id: 'configurable',
        attributes: [{
          attribute_id: '93',
          label: 'Color',
          values: [
            {
              value_index: 49, label: 'Black', swatch_type: 'color', swatch_value: '#000',
            },
            {
              value_index: 50, label: 'White', swatch_type: 'color', swatch_value: '#fff',
            },
          ],
        }],
        variants: [{
          product_id: 55,
          sku: 'shirt-black',
          name: 'Shirt Black',
          price: 20,
          configurable_item_options: [{ option_id: '93', option_value: 49 }],
          attributes: { 93: 49 },
        }],
      },
      qty: 1,
      selection: { configurable: { 93: 49 } },
    });

    assert.match(html, />Shirt</);
    assert.doesNotMatch(html, /Shirt \(shirt-black\) \(shirt-black\)/);
    assert.match(html, /Color/);
    assert.match(html, /Black/);
    assert.match(html, /data-recurbuy-configurable-attribute="93"/);
    assert.match(html, /data-value-index="49"/);
    assert.match(html, /Selected: Shirt Black/);
  });

  it('resolveProductHeading prefers parent configure name', () => {
    assert.deepEqual(
      resolveProductHeading(
        { name: 'Configurable (Configurable-black-L)', sku: 'Configurable-black-L' },
        { name: 'Configurable' },
      ),
      { name: 'Configurable', sku: 'Configurable-black-L' },
    );
  });

  it('skips catalog image swatches and dedupes selected label', () => {
    assert.deepEqual(
      resolveSwatchPresentation({
        swatch_type: 'image',
        swatch_value: 'https://cdn.example/media/catalog/product/a.jpg',
        label: 'black',
      }),
      { type: 'color', value: '#111111' },
    );
    assert.deepEqual(
      resolveSwatchPresentation({
        swatch_type: 'image',
        swatch_value: '/media/x.jpg',
        label: 'L',
      }),
      { type: 'text', value: '' },
    );
    assert.equal(
      formatSelectedVariant({ name: 'Configurable-black-L', sku: 'Configurable-black-L' }),
      'Configurable-black-L',
    );
  });

  it('renders bundle and grouped options', () => {
    const bundleHtml = renderEditItemForm({
      profile: {
        profile_id: 1,
        actions: { items: [{ item_id: 1, is_edit_item_available: true }] },
      },
      item: { item_id: 1, product_id: 48, name: 'Bundle', product_type: 'bundle' },
      configure: {
        type_id: 'bundle',
        product_id: 48,
        bundle_options: [{
          option_id: 1,
          title: 'Pack',
          required: true,
          selections: [
            {
              selection_id: 7, name: 'Small', sku: 's', price: 1, can_change_quantity: true,
            },
          ],
        }],
      },
      qty: 1,
      selection: { bundleSelection: { 1: 7 }, bundleQty: { 1: 2 } },
    });
    assert.match(bundleHtml, /Pack/);
    assert.match(bundleHtml, /name="bundle_option\[1\]"/);
    assert.match(bundleHtml, /name="bundle_option_qty\[1\]"/);

    const groupedHtml = renderEditItemForm({
      profile: {
        profile_id: 1,
        actions: { items: [{ item_id: 2, is_edit_item_available: true }] },
      },
      item: { item_id: 2, product_id: 60, name: 'Grouped', product_type: 'grouped' },
      configure: {
        type_id: 'grouped',
        product_id: 60,
        grouped_associated: [{
          product_id: 61, sku: 'a', name: 'Child A', price: 5, default_qty: 1,
        }],
      },
      qty: 1,
      selection: { groupedQty: { 61: 2 } },
    });
    assert.match(groupedHtml, /Child A/);
    assert.match(groupedHtml, /name="super_group\[61\]"/);
  });

  it('gates on is_edit_item_available', () => {
    assert.equal(
      isEditItemAvailable(
        { item_id: 11 },
        { items: [{ item_id: 11, is_edit_item_available: false }] },
      ),
      false,
    );
    const html = renderEditItemForm({
      profile: {
        profile_id: 1,
        actions: { items: [{ item_id: 11, is_edit_item_available: false }] },
      },
      item: { item_id: 11, product_id: 4, name: 'Coffee' },
      configure: null,
      qty: 1,
      selection: {},
    });
    assert.match(html, /not available/i);
    assert.doesNotMatch(html, /name="qty"/);
  });

  it('collects configure results for configurable and validates required', () => {
    const configure = {
      type_id: 'configurable',
      product_id: 10,
      attributes: [{ attribute_id: '93', label: 'Color', values: [] }],
      variants: [{
        product_id: 55,
        sku: 'x',
        name: 'X',
        price: 1,
        configurable_item_options: [{ option_id: '93', option_value: 49 }],
        attributes: { 93: 49 },
      }],
    };
    const bad = collectConfigureResult(configure, { configurable: {} });
    assert.equal(bad.ok, false);

    const good = collectConfigureResult(configure, { configurable: { 93: 49 } });
    assert.equal(good.ok, true);
    assert.equal(good.result.selected_product_id, 55);
  });

  it('prefills bundle selection from stored info_buyRequest', () => {
    const selection = buildInitialSelection(
      {
        type_id: 'bundle',
        bundle_options: [{
          option_id: 1,
          required: true,
          selections: [
            {
              selection_id: 7, is_default: true, can_change_quantity: false,
            },
            {
              selection_id: 8, is_default: false, can_change_quantity: false,
            },
          ],
        }],
      },
      {
        product_options: {
          info_buyRequest: {
            bundle_option: { 1: [8] },
            bundle_option_qty: { 1: 3 },
          },
        },
      },
    );
    assert.equal(selection.bundleSelection['1'], 8);
    assert.equal(selection.bundleQty['1'], 3);
  });
});
