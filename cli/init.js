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
import { applySuitePatches } from './apply-patches.js';
import { resolveSuite } from './suite-resolve.js';
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
 * @param {{ cwd: string, dryRun?: boolean, suite?: string, repatch?: boolean }} options
 */
export function runInit(options) {
  const {
    cwd, dryRun = false, repatch = false,
  } = options;
  const report = [];
  const warnings = [];

  const resolved = resolveSuite({ cwd, explicitSuite: options.suite });
  const { suite } = resolved;
  report.push(`suite: ${suite} (${resolved.source})`);
  if (resolved.warning) warnings.push(resolved.warning);

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
  const patched = applySuitePatches({
    cwd,
    suite,
    dryRun,
    mode: repatch ? 'repatch' : 'init',
  });
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
  const blockEntry = path.join(blockDest, 'commerce-subscriptions.js');
  if (!fs.existsSync(path.join(blockSrc, 'commerce-subscriptions.js'))) {
    warnings.push(`package template missing: ${blockSrc} — reinstall @dropins/storefront-recurbuy`);
  } else if (fs.existsSync(blockEntry)) {
    report.push('blocks/commerce-subscriptions: already exists');
  } else {
    report.push('blocks/commerce-subscriptions: create');
    if (!dryRun) {
      fs.mkdirSync(path.dirname(blockDest), { recursive: true });
      fs.cpSync(blockSrc, blockDest, { recursive: true });
      if (!fs.existsSync(blockEntry)) {
        warnings.push('blocks/commerce-subscriptions copy failed — check disk permissions and re-run init');
      }
    }
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
  report.push('  3. npx recurbuy-eds publish-content --org=… --repo=…');
  report.push('  4. npx recurbuy-eds doctor --org=… --repo=…');
  report.push('  5. RecurBuy panel: Connection + AccS webhooks + subscription options on products');
  report.push('');
  report.push('Later upgrades: bump package → npm install → npx recurbuy-eds upgrade → npm run install:dropins');

  return { report, warnings, failed: patched.failed };
}
