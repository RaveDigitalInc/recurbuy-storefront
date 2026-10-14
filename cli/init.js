import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEP_KEY,
  ensureAliasDependency,
  ensureBuildMjsCartFragment,
  REQUIRED_CONFIG_KEYS,
  ensureImportMap,
  loadPackageJson,
  readText,
  resolvePath,
  writeText,
} from './lib.js';
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
 * @param {{ cwd: string, dryRun?: boolean }} options
 */
export function runInit(options) {
  const { cwd, dryRun = false } = options;
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

  // 2) head.html import map
  const headPath = resolvePath(cwd, 'head.html');
  if (!fs.existsSync(headPath)) {
    warnings.push('head.html not found — add import map manually (see README)');
  } else {
    const head = readText(headPath);
    const mapped = ensureImportMap(head);
    if (mapped.missingAnchor) {
      warnings.push('head.html: could not find import map — add RecurBuy entries manually');
    } else if (mapped.changed) {
      report.push('head.html: import map entries');
      if (!dryRun) writeText(headPath, mapped.source);
    } else {
      report.push('head.html: import map already OK');
    }
  }

  // 3) build.mjs GraphQL fragment
  const buildPath = resolvePath(cwd, 'build.mjs');
  if (!fs.existsSync(buildPath)) {
    warnings.push('build.mjs not found — add cart custom_attributes fragment manually');
  } else {
    const build = readText(buildPath);
    const next = ensureBuildMjsCartFragment(build);
    if (next.missingAnchor) {
      warnings.push('build.mjs: could not inject cart fragment — see README');
    } else if (next.alreadyPresent) {
      report.push('build.mjs: custom_attributes already present');
    } else if (next.changed) {
      report.push('build.mjs: cart custom_attributes fragment');
      if (!dryRun) writeText(buildPath, next.source);
    }
  }

  // 4) cart initializer loads RecurBuy
  const cartInitPath = resolvePath(cwd, 'scripts', 'initializers', 'cart.js');
  if (!fs.existsSync(cartInitPath)) {
    warnings.push('scripts/initializers/cart.js not found');
  } else {
    patchCartInitializer(cartInitPath, { dryRun, report });
  }

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
  report.push('  3. Publish the /customer/subscriptions page (init may have created the HTML)');
  report.push('  4. npx recurbuy-eds doctor');
  report.push('  5. RecurBuy panel: Connection + AccS webhooks + subscription options on products');

  return { report, warnings };
}

/**
 * The single stock touch: the cart initializer loads the RecurBuy initializer.
 * @param {string} filePath
 * @param {{ dryRun: boolean, report: string[] }} ctx
 */
function patchCartInitializer(filePath, ctx) {
  const source = readText(filePath);
  const loaderImport = "import './recurbuy.js';";
  if (source.includes(loaderImport)) {
    ctx.report.push('scripts/initializers/cart.js: already loads RecurBuy');
    return;
  }

  const imports = [...source.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*\n/gm)];
  const last = imports[imports.length - 1];
  const at = last ? last.index + last[0].length : 0;
  ctx.report.push('scripts/initializers/cart.js: load RecurBuy initializer');
  if (!ctx.dryRun) {
    writeText(filePath, `${source.slice(0, at)}${loaderImport}\n${source.slice(at)}`);
  }
}
