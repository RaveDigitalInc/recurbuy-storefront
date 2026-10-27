import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  filterHiddenCartLineOptions,
  isCartLineOptionConfiguration,
  rememberHiddenCartLineUid,
  resetCartLineOptionHideStateForTests,
} from '../src/helpers/cart-line-option-data.js';
import { createDeferredRoots } from '../src/extend/deferred-roots.js';

beforeEach(() => resetCartLineOptionHideStateForTests());

const option = (label, value, uid) => ({
  customizable_option_uid: uid,
  label,
  values: [{ value }],
});

describe('isCartLineOptionConfiguration', () => {
  it('never matches by title, not even the word Subscription', () => {
    assert.equal(isCartLineOptionConfiguration(option('Subscription', 'Gold'), '14'), false);
    assert.equal(isCartLineOptionConfiguration(option('Subscription', 'Gold'), ''), false);
  });

  it('matches [#id] only when it equals the line own option id', () => {
    const merge = option('Plan', 'Monthly 12 (50%) [#14]');

    assert.equal(isCartLineOptionConfiguration(merge, '14'), true);
    assert.equal(isCartLineOptionConfiguration(merge, '15'), false);
    assert.equal(isCartLineOptionConfiguration(merge, ''), false);
    assert.equal(isCartLineOptionConfiguration(merge, '0'), false);
    assert.equal(isCartLineOptionConfiguration(option('Note', 'Gift [#5]'), '14'), false);
  });

  it('matches a known cart-line uid regardless of the value', () => {
    rememberHiddenCartLineUid('uid-merge');

    assert.equal(isCartLineOptionConfiguration(option('Plan', 'x', 'uid-merge'), ''), true);
    assert.equal(isCartLineOptionConfiguration(option('Plan', 'x', 'uid-other'), ''), false);
  });

  it('tolerates malformed options', () => {
    assert.equal(isCartLineOptionConfiguration(null, '14'), false);
    assert.equal(isCartLineOptionConfiguration({ label: 'x', values: null }, '14'), false);
  });
});

describe('filterHiddenCartLineOptions', () => {
  it('returns the same array while nothing is hidden or matches', () => {
    const options = [{ id: 'a', label: 'Subscription' }];
    assert.equal(filterHiddenCartLineOptions(options), options);

    rememberHiddenCartLineUid('uid-merge');
    assert.equal(filterHiddenCartLineOptions(options), options);
  });

  it('filters by uid only, never by title', () => {
    rememberHiddenCartLineUid('uid-merge');
    const out = filterHiddenCartLineOptions([
      { id: 'uid-merge', label: 'Plan' },
      { id: 'uid-host', label: 'Subscription' },
    ]);

    assert.deepEqual(out, [{ id: 'uid-host', label: 'Subscription' }]);
  });
});

describe('createDeferredRoots', () => {
  const fakeRoot = () => {
    const root = { isConnected: false, remove() { root.isConnected = false; } };
    return root;
  };

  it('keeps roots out of the document until there is something to show', () => {
    const roots = [fakeRoot(), fakeRoot()];
    let attached = 0;
    const deferred = createDeferredRoots({
      roots,
      attach: () => { attached += 1; roots.forEach((root) => { root.isConnected = true; }); },
    });

    deferred.setVisible(false);
    assert.equal(attached, 0);
    assert.deepEqual(roots.map((root) => root.isConnected), [false, false]);

    deferred.setVisible(true);
    deferred.setVisible(true);
    assert.equal(attached, 1, 'attached once');

    deferred.setVisible(false);
    assert.deepEqual(roots.map((root) => root.isConnected), [false, false]);

    deferred.setVisible(true);
    deferred.dispose();
    assert.deepEqual(roots.map((root) => root.isConnected), [false, false]);
  });
});
