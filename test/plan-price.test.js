import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_DRIFT_RATIO, isCatalogDrift } from '../src/plan-price.js';

describe('isCatalogDrift', () => {
  it('flags a commerce price well above the plan price', () => {
    assert.equal(isCatalogDrift(45, 22.5), true);
  });

  it('accepts a commerce price equal to or slightly above the plan price', () => {
    assert.equal(isCatalogDrift(22.5, 22.5), false);
    assert.equal(isCatalogDrift(22.5 * CATALOG_DRIFT_RATIO, 22.5), false);
  });

  it('never flags when either side is unknown or the plan is free', () => {
    assert.equal(isCatalogDrift(null, 22.5), false);
    assert.equal(isCatalogDrift(45, undefined), false);
    assert.equal(isCatalogDrift(45, 0), false);
    assert.equal(isCatalogDrift('45', 22.5), false);
  });
});
