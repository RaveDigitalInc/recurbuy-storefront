#!/usr/bin/env node
/**
 * End-to-end test: bump a stock patch version → upgrade → doctor → repatch → restore.
 *
 * Default target: ../../cleanEds/my-storefront (override with --dir).
 * Temporarily mutates package patches/, then restores them.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PACKAGE_ROOT, 'bin', 'recurbuy-eds.js');
const MANIFEST = path.join(PACKAGE_ROOT, 'patches', '11.0.0', 'manifest.json');
const PATCH_FILE = path.join(PACKAGE_ROOT, 'patches', '11.0.0', 'build.mjs.patch');

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const shopDir = path.resolve(
  dirFlag === -1
    ? path.join(PACKAGE_ROOT, '..', 'cleanEds', 'my-storefront')
    : args[dirFlag + 1],
);

const MARKER = 'recurbuy-eds:build-cart-attrs-v2';
const failures = [];

function step(title, fn) {
  process.stdout.write(`- ${title} ... `);
  try {
    const out = fn();
    console.log('ok');
    return out;
  } catch (error) {
    console.log('FAILED');
    failures.push(`${title}\n${error.stdout || ''}${error.stderr || ''}${error.message}`);
    return null;
  }
}

function runCli(cliArgs, cwd = shopDir, { allowFail = false } = {}) {
  try {
    return execFileSync(process.execPath, [CLI, ...cliArgs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFail) {
      return `${error.stdout || ''}${error.stderr || ''}`;
    }
    throw error;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(`Package: ${PACKAGE_ROOT}`);
console.log(`Shop:    ${shopDir}\n`);

assert(fs.existsSync(shopDir), `shop dir missing: ${shopDir}`);
assert(fs.existsSync(path.join(shopDir, 'build.mjs')), 'shop build.mjs missing');

const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurbuy-patch-bak-'));
const shopBuild = path.join(shopDir, 'build.mjs');
const shopState = path.join(shopDir, '.recurbuy-eds.json');

step('backup shop + package patch files', () => {
  fs.copyFileSync(shopBuild, path.join(bakDir, 'build.mjs'));
  if (fs.existsSync(shopState)) fs.copyFileSync(shopState, path.join(bakDir, '.recurbuy-eds.json'));
  fs.copyFileSync(MANIFEST, path.join(bakDir, 'manifest.json'));
  fs.copyFileSync(PATCH_FILE, path.join(bakDir, 'build.mjs.patch'));
});

step('baseline: upgrade is idle (all patches current)', () => {
  // Ensure state exists
  runCli(['upgrade']);
  const out = runCli(['upgrade']);
  assert(out.includes('none pending') || out.includes('up to date'), `unexpected:\n${out}`);
});

step('doctor: stock patches current', () => {
  const out = runCli(['doctor', '--skip-content']);
  assert(out.includes('stock patches current'), out);
});

step('mutate package: build-cart-attrs → v2 + new hunk', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const entry = manifest.patches.find((p) => p.id === 'build-cart-attrs');
  assert(entry, 'build-cart-attrs missing in manifest');
  entry.version = 2;
  delete entry.detect;
  delete entry.alreadyAppliedNeedle;
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // Delta patch against already-v1-patched build.mjs (CLI infers "done" from +lines)
  fs.writeFileSync(PATCH_FILE, `--- a/build.mjs
+++ b/build.mjs
@@ -1,5 +1,6 @@
 import { overrideGQLOperations } from '@dropins/build-tools/gql-extend.js';
 import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';
+// ${MARKER}
 
 overrideGQLOperations([
   // ACCS does not have Downloadable Items
`);
});

step('doctor: sees pending build-cart-attrs@2', () => {
  const out = runCli(['doctor', '--skip-content']);
  assert(out.includes('pending stock patches'), out);
  assert(out.includes('build-cart-attrs@2'), out);
  assert(out.includes('npx recurbuy-eds upgrade'), out);
});

step('upgrade: applies v2 hunk', () => {
  const out = runCli(['upgrade']);
  assert(out.includes('build-cart-attrs@2: applied'), out);
  const build = fs.readFileSync(shopBuild, 'utf8');
  assert(build.includes(MARKER), 'marker not in build.mjs after upgrade');
  const state = JSON.parse(fs.readFileSync(shopState, 'utf8'));
  assert(state.appliedPatches['build-cart-attrs'].version === 2, 'state version != 2');
});

step('upgrade again: no pending / up to date', () => {
  const out = runCli(['upgrade']);
  assert(
    out.includes('none pending') || out.includes('build-cart-attrs@2: up to date'),
    out,
  );
  const build = fs.readFileSync(shopBuild, 'utf8');
  const count = build.split(MARKER).length - 1;
  assert(count === 1, `marker duplicated (${count})`);
});

step('upgrade --repatch: mark-only (+lines already in file)', () => {
  const out = runCli(['upgrade', '--repatch']);
  assert(
    out.includes('already in file') || out.includes('up to date') || out.includes('content OK'),
    out,
  );
  const count = fs.readFileSync(shopBuild, 'utf8').split(MARKER).length - 1;
  assert(count === 1, 'repatch must not duplicate marker');
});

step('doctor: patches current after v2', () => {
  const out = runCli(['doctor', '--skip-content']);
  assert(out.includes('stock patches current'), out);
  assert(!out.includes('pending stock patches'), out);
});

step('simulate bad bump (v3, +lines already present, bad context) → soft warn + state@3', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const entry = manifest.patches.find((p) => p.id === 'build-cart-attrs');
  entry.version = 3;
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  // Same +line already in file, but context does not match → soft path
  fs.writeFileSync(PATCH_FILE, `--- a/build.mjs
+++ b/build.mjs
@@ -1,3 +1,4 @@
 import { this_context_does_not_exist } from 'nowhere';
+// ${MARKER}
`);

  const out = runCli(['upgrade'], shopDir, { allowFail: true });
  assert(out.includes('could not re-diff') || out.includes('already in file'), out);
  const state = JSON.parse(fs.readFileSync(shopState, 'utf8'));
  assert(state.appliedPatches['build-cart-attrs'].version === 3, 'state version != 3 after soft-fail');
});

step('restore package patch files', () => {
  fs.copyFileSync(path.join(bakDir, 'manifest.json'), MANIFEST);
  fs.copyFileSync(path.join(bakDir, 'build.mjs.patch'), PATCH_FILE);
});

step('restore shop build.mjs + state', () => {
  fs.copyFileSync(path.join(bakDir, 'build.mjs'), shopBuild);
  const stateBak = path.join(bakDir, '.recurbuy-eds.json');
  if (fs.existsSync(stateBak)) {
    fs.copyFileSync(stateBak, shopState);
  }
});

step('final upgrade records v1 state cleanly', () => {
  const out = runCli(['upgrade']);
  assert(
    out.includes('already in file') || out.includes('content OK') || out.includes('up to date') || out.includes('none pending'),
    out,
  );
  const build = fs.readFileSync(shopBuild, 'utf8');
  assert(!build.includes(MARKER), 'test marker leaked into shop build.mjs');
  const state = JSON.parse(fs.readFileSync(shopState, 'utf8'));
  assert(state.appliedPatches['build-cart-attrs'].version === 1, 'restored state version != 1');
});

step('final doctor clean', () => {
  const out = runCli(['doctor', '--skip-content']);
  assert(out.includes('stock patches current'), out);
});

fs.rmSync(bakDir, { recursive: true, force: true });

if (failures.length) {
  console.error('\nFAILED:\n');
  failures.forEach((f) => console.error(f, '\n'));
  process.exit(1);
}

console.log('\nverify-patch-upgrade: all scenarios passed');
