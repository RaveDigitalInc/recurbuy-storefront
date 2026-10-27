#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  decidePatchAction,
  listPendingPatches,
  normalizePatchEntry,
  patchEffectPresent,
  plusLinesFromPatch,
} from '../cli/apply-patches.js';
import { compareVersions } from '../cli/install-state.js';
import {
  suiteCandidatesForVersion,
  suiteForBoilerplate,
} from '../cli/suite-resolve.js';

const entry = normalizePatchEntry({
  id: 'build-cart-attrs',
  version: 2,
  file: 'build.mjs',
  patch: 'build.mjs.patch',
}, 0);
assert.equal(entry.id, 'build-cart-attrs');
assert.equal(entry.version, 2);
assert.equal(entry.detect, undefined);

const patchV1 = `--- a/build.mjs
+++ b/build.mjs
@@ -1,3 +1,4 @@
 import { overrideGQLOperations } from '@dropins/build-tools/gql-extend.js';
+import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';
 
 overrideGQLOperations([
`;

assert.deepEqual(plusLinesFromPatch(patchV1), [
  'import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from \'@dropins/storefront-recurbuy/graphql.js\';',
]);
assert.equal(
  patchEffectPresent('nope', patchV1),
  false,
);
assert.equal(
  patchEffectPresent(
    "import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';\n",
    patchV1,
  ),
  true,
);

assert.equal(
  decidePatchAction({
    entry,
    source: 'no markers',
    patchText: patchV1,
    recorded: undefined,
    mode: 'init',
  }),
  'apply',
);

assert.equal(
  decidePatchAction({
    entry: { ...entry, version: 1 },
    source: "import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';",
    patchText: patchV1,
    recorded: undefined,
    mode: 'init',
  }),
  'mark-only',
);

assert.equal(
  decidePatchAction({
    entry,
    source: "import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';",
    patchText: patchV1,
    recorded: { version: 1 },
    mode: 'upgrade',
  }),
  'apply',
);

assert.equal(
  decidePatchAction({
    entry: { ...entry, version: 1 },
    source: 'anything',
    patchText: patchV1,
    recorded: { version: 1 },
    mode: 'upgrade',
  }),
  'skip-current',
);

assert.equal(compareVersions('0.2.1', '0.2.0') > 0, true);
assert.equal(compareVersions('0.2.0', '0.2.0'), 0);

const pending = listPendingPatches('11.0.0', {
  appliedPatches: {
    'cart-loader': { id: 'cart-loader', version: 1, file: 'x', appliedAt: '' },
  },
});
assert.ok(pending.some((p) => p.id === 'import-map'));
assert.ok(pending.some((p) => p.id === 'build-cart-attrs'));
assert.ok(!pending.some((p) => p.id === 'cart-loader'));

assert.deepEqual(suiteCandidatesForVersion('11.0.0'), ['11.0.0', '11.0', '11']);
assert.equal(suiteForBoilerplate({ version: '11.0.0', name: '@adobe/aem-boilerplate-commerce' }), '11.0.0');

console.log('check-patches: ok');
