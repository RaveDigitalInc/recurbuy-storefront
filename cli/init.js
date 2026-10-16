import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEP_KEY,
  ensureAliasDependency,
  REQUIRED_CONFIG_KEYS,
  loadPackageJson,
  readText,
  resolvePath,
  writeText,
} from './lib.js';
import { applySuitePatches, DEFAULT_SUITE } from './apply-patches.js';
import { runEnsureStorefrontExtras } from './storefront-extras.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

/**
 * @param {string} cwd
 * @returns {Record<string, unknown>} `public.default` of config.json, or {}
 */
function readConfigDefaults(cwd) {
  try {
    const config = JSON.parse(readText(resolvePath(cwd, 'config.json')));
    return config?.public?.default || config?.default || {};
  } catch {
    return {};
  }
}

/**
 * @param {{ cwd: string, dryRun?: boolean, suite?: string }} options
 */
export function runInit(options) {
  const { cwd, dryRun = false, suite = DEFAULT_SUITE } = options;
  const report = [];
  const warnings = [];

  // 1) package.json alias
  const pkg = loadPackageJson(cwd);
  const { dependencies, changed: depChanged } = ensureAliasDependency(pkg.data);
  if (depChanged) {
    report.push(`package.json: add ${DEFAULT_DEP_KEY}`);
    if (!dryRun) {
      pkg.data.dependencies = dependencies;
      writeText(pkg.filePath, `${JSON.stringify(pkg.data, null, 2)}\n`);
    }
  } else {
    report.push(`package.json: ${DEFAULT_DEP_KEY} already present`);
  }

  // 2–4) stock files via versioned unified patches (not regex)
  const patched = applySuitePatches({ cwd, suite, dryRun });
  patched.report.forEach((line) => report.push(line));
  patched.warnings.forEach((line) => warnings.push(line));

  // 5) RecurBuy initializer (new file)
  const recurbuyInitPath = resolvePath(cwd, 'scripts', 'initializers', 'recurbuy.js');
  const initTemplate = readText(path.join(TEMPLATES, 'initializers', 'recurbuy.js'));
  if (!fs.existsSync(recurbuyInitPath)) {
    report.push('scripts/initializers/recurbuy.js: create');
    if (!dryRun) writeText(recurbuyInitPath, initTemplate);
  } else {
    report.push('scripts/initializers/recurbuy.js: already exists');
  }

  // 6) commerce-subscriptions block
  const blockDest = resolvePath(cwd, 'blocks', 'commerce-subscriptions');
  const blockSrc = path.join(TEMPLATES, 'blocks', 'commerce-subscriptions');
  if (!fs.existsSync(blockDest)) {
    report.push('blocks/commerce-subscriptions: create');
    if (!dryRun) fs.cpSync(blockSrc, blockDest, { recursive: true });
  } else {
    report.push('blocks/commerce-subscriptions: already exists');
  }

  report.push('');
  report.push('Content + config:');
  const extras = runEnsureStorefrontExtras({ cwd, dryRun });
  extras.report.forEach((line) => report.push(`  ${line}`));
  extras.warnings.forEach((line) => warnings.push(line));
  report.push('  PDP/cart/mini-PDP: hooks + auto-mount via scripts/initializers/recurbuy.js');

  report.push('');
  report.push('Enter these 2 values in config.json -> public.default:');
  const filled = readConfigDefaults(cwd);
  Object.entries(REQUIRED_CONFIG_KEYS).forEach(([key, description]) => {
    report.push(`  ${filled[key] ? '✓' : '→'} ${key}: ${description}`);
  });

  report.push('');
  report.push('Next:');
  report.push('  1. npm run install:dropins');
  report.push('  2. Enter the 2 values above in config.json');
  report.push('  3. Publish the /customer/subscriptions page (or use account auto-mount when available)');
  report.push('  4. npx recurbuy-eds doctor');
  report.push('  5. RecurBuy panel: Connection + AccS webhooks + subscription options on products');

  return { report, warnings, failed: patched.failed };
}
