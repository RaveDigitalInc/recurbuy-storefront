import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patchModelHook } from '../src/extend/model-config-patch.js';

/** Drop-in `config` stand-in: setConfig replaces the whole config. */
function createConfigApi(initial = {}) {
  let config = initial;
  return {
    getConfig: () => config,
    setConfig: (next) => { config = next; },
  };
}

const wrapOptions = (prior) => (options) => [...(prior ? prior(options) : options), 'ours'];

describe('patchModelHook', () => {
  it('installs without a host hook and removes itself on dispose', () => {
    const api = createConfigApi({ other: 1 });
    const dispose = patchModelHook(api, {
      model: 'ProductOptions', hook: 'optionsTransformer', create: wrapOptions,
    });

    assert.deepEqual(api.getConfig().models.ProductOptions.optionsTransformer(['a']), ['a', 'ours']);
    assert.equal(api.getConfig().other, 1);

    dispose();
    assert.equal(api.getConfig().models.ProductOptions.optionsTransformer, undefined);
    assert.equal(api.getConfig().other, 1);
  });

  it('composes with the host hook and restores the same function on dispose', () => {
    const hostHook = (options) => [...options, 'host'];
    const api = createConfigApi({
      models: { ProductOptions: { optionsTransformer: hostHook, keep: true }, Other: { x: 1 } },
    });
    const dispose = patchModelHook(api, {
      model: 'ProductOptions', hook: 'optionsTransformer', create: wrapOptions,
    });

    assert.deepEqual(
      api.getConfig().models.ProductOptions.optionsTransformer(['a']),
      ['a', 'host', 'ours'],
    );

    dispose();
    const { models } = api.getConfig();
    assert.equal(models.ProductOptions.optionsTransformer, hostHook);
    assert.equal(models.ProductOptions.keep, true);
    assert.deepEqual(models.Other, { x: 1 });
  });

  it('becomes a pass-through when the host composed on top and cannot be unlinked', () => {
    const hostHook = (options) => [...options, 'host'];
    const api = createConfigApi({
      models: { ProductOptions: { optionsTransformer: hostHook } },
    });
    const dispose = patchModelHook(api, {
      model: 'ProductOptions',
      hook: 'optionsTransformer',
      create: wrapOptions,
      passThrough: (options) => options,
    });
    const ours = api.getConfig().models.ProductOptions.optionsTransformer;
    const lateHost = (options) => [...ours(options), 'late'];
    api.setConfig({ models: { ProductOptions: { optionsTransformer: lateHost } } });

    dispose();

    assert.equal(api.getConfig().models.ProductOptions.optionsTransformer, lateHost);
    assert.deepEqual(lateHost(['a']), ['a', 'host', 'late']);
  });

  it('passes the input through when disposed with no host hook underneath', () => {
    const api = createConfigApi();
    const dispose = patchModelHook(api, {
      model: 'ProductOptions',
      hook: 'optionsTransformer',
      create: wrapOptions,
      passThrough: (options) => options,
    });
    const ours = api.getConfig().models.ProductOptions.optionsTransformer;
    api.setConfig({ models: { ProductOptions: { optionsTransformer: (o) => ours(o) } } });

    dispose();

    assert.deepEqual(ours(['a']), ['a']);
  });

  it('dispose is idempotent', () => {
    const api = createConfigApi();
    const dispose = patchModelHook(api, {
      model: 'CartModel', hook: 'transformer', create: () => () => ({}),
    });
    dispose();
    api.setConfig({ models: { CartModel: { transformer: () => 'later' } } });
    dispose();
    assert.equal(api.getConfig().models.CartModel.transformer(), 'later');
  });

  it('is a no-op without a usable config api', () => {
    const dispose = patchModelHook({}, {
      model: 'CartModel', hook: 'transformer', create: () => () => ({}),
    });
    assert.equal(typeof dispose, 'function');
    dispose();
  });
});
