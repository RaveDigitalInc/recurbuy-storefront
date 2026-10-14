#!/usr/bin/env node
/**
 * End-to-end install check: a fresh aem-boilerplate-commerce clone, this package
 * installed from a real tarball exactly as the README describes, then
 * init -> install:dropins -> doctor, a stock-file diff check and an uninstall.
 *
 * Usage: npm run verify:install -- [--ref <git ref>] [--dir <path>] [--keep]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOILERPLATE_URL = 'https://github.com/hlxsites/aem-boilerplate-commerce.git';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stock files `init` + `install:dropins` are allowed to change. */
const ALLOWED_STOCK_CHANGES = new Set([
  'build.mjs',
  'head.html',
  'package.json',
  'package-lock.json',
  'scripts/initializers/cart.js',
  'scripts/__dropins__/storefront-cart/fragments.js',
]);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const ref = option('--ref', 'main');
const keep = args.includes('--keep');
const workDir = option('--dir', fs.mkdtempSync(path.join(os.tmpdir(), 'recurbuy-verify-')));

const failures = [];

function run(command, commandArgs, cwd) {
  return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function step(title, action) {
  process.stdout.write(`- ${title} ... `);
  try {
    const result = action();
    console.log('ok');
    return result;
  } catch (error) {
    console.log('FAILED');
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message}`.trim();
    failures.push(`${title}\n${output}`);
    return null;
  }
}

function check(title, condition, detail = '') {
  console.log(`- ${title} ... ${condition ? 'ok' : 'FAILED'}`);
  if (!condition) failures.push(`${title}\n${detail}`);
}

function changedTrackedFiles(shopDir) {
  return run('git', ['diff', '--name-only'], shopDir).split('\n').filter(Boolean);
}

console.log(`Boilerplate ref: ${ref}\nWork dir: ${workDir}\n`);
const shopDir = path.join(workDir, 'shop');

step('clone boilerplate', () => run('git', ['clone', '--depth', '1', '--branch', ref, BOILERPLATE_URL, shopDir], workDir));
step('npm install (boilerplate)', () => run('npm', ['install'], shopDir));

const tarball = step('npm pack (this package)', () => {
  const output = run('npm', ['pack', '--pack-destination', workDir, '--silent'], PACKAGE_ROOT);
  return path.join(workDir, output.trim().split('\n').pop());
});

step('npm install alias dependency', () => run(
  'npm',
  ['install', `@dropins/storefront-recurbuy@file:${tarball}`],
  shopDir,
));

step('prepare config.json', () => {
  const config = JSON.parse(fs.readFileSync(path.join(shopDir, 'demo-config.json'), 'utf8'));
  fs.writeFileSync(path.join(shopDir, 'config.json'), JSON.stringify(config, null, 2));
});

const bin = path.join(shopDir, 'node_modules', '.bin', 'recurbuy-eds');
step('recurbuy-eds init', () => run(bin, ['init'], shopDir));

step('fill subscriptions-* keys', () => {
  const file = path.join(shopDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(config.public.default, {
    'subscriptions-storefront-url': 'https://panel.example.test',
    'subscriptions-connection-token': 'verify-token',
  });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
});

step('npm run install:dropins', () => run('npm', ['run', 'install:dropins'], shopDir));
step('recurbuy-eds doctor', () => run(bin, ['doctor'], shopDir));

const changed = changedTrackedFiles(shopDir);
const unexpected = changed.filter((file) => !ALLOWED_STOCK_CHANGES.has(file));
check(
  `stock files changed only at known touch points (${changed.length})`,
  unexpected.length === 0,
  `Unexpected: ${unexpected.join(', ')}`,
);
check(
  'vendored drop-in present',
  fs.existsSync(path.join(shopDir, 'scripts', '__dropins__', 'storefront-recurbuy', 'api.js')),
);

step('recurbuy-eds uninstall --remove-files', () => run(bin, ['uninstall', '--remove-files'], shopDir));
const leftovers = changedTrackedFiles(shopDir).filter((file) => ![
  'package.json',
  'package-lock.json',
  'scripts/__dropins__/storefront-cart/fragments.js',
].includes(file));
check('uninstall restores stock files', leftovers.length === 0, `Still changed: ${leftovers.join(', ')}`);

if (!keep && failures.length === 0) fs.rmSync(workDir, { recursive: true, force: true });

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed (work dir kept: ${workDir}):\n`);
  failures.forEach((failure) => console.log(`${failure}\n`));
  process.exit(1);
}
console.log('\nAll checks passed.');
