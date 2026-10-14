import fs from 'node:fs';
import {
  DEFAULT_DEP_KEY,
  IMPORT_MAP_ENTRIES,
  loadPackageJson,
  readText,
  removeBuildMjsCartFragment,
  resolvePath,
  writeText,
} from './lib.js';

/**
 * Best-effort rollback of `init`: dependency, import map, cart initializer, optional scaffold.
 *
 * @param {{ cwd: string, dryRun?: boolean, removeFiles?: boolean }} options
 */
export function runUninstall(options) {
  const { cwd, dryRun = false, removeFiles = false } = options;
  const report = [];
  const warnings = [];

  const pkg = loadPackageJson(cwd);
  if (pkg.data.dependencies?.[DEFAULT_DEP_KEY]) {
    report.push(`package.json: remove ${DEFAULT_DEP_KEY}`);
    if (!dryRun) {
      delete pkg.data.dependencies[DEFAULT_DEP_KEY];
      writeText(pkg.filePath, `${JSON.stringify(pkg.data, null, 2)}\n`);
    }
  }

  const headPath = resolvePath(cwd, 'head.html');
  if (fs.existsSync(headPath)) {
    let head = readText(headPath);
    let changed = false;
    for (const key of Object.keys(IMPORT_MAP_ENTRIES)) {
      const re = new RegExp(`,\\s*"${key.replace(/\//g, '\\/')}"\\s*:\\s*"[^"]+"`);
      if (re.test(head)) {
        head = head.replace(re, '');
        changed = true;
      }
      const reFirst = new RegExp(`"${key.replace(/\//g, '\\/')}"\\s*:\\s*"[^"]+"\\s*,?`);
      if (reFirst.test(head) && head.includes(`"${key}"`)) {
        head = head.replace(reFirst, '');
        changed = true;
      }
    }
    if (changed) {
      report.push('head.html: remove RecurBuy import map entries');
      if (!dryRun) writeText(headPath, head);
    }
  }

  const buildPath = resolvePath(cwd, 'build.mjs');
  if (fs.existsSync(buildPath)) {
    const { source, changed } = removeBuildMjsCartFragment(readText(buildPath));
    if (changed) {
      report.push('build.mjs: remove cart custom_attributes fragment');
      if (!dryRun) writeText(buildPath, source);
    }
  }

  const cartInitPath = resolvePath(cwd, 'scripts', 'initializers', 'cart.js');
  if (fs.existsSync(cartInitPath)) {
    let cartInit = readText(cartInitPath);
    let cartChanged = false;

    if (cartInit.includes("import './recurbuy.js';")) {
      cartInit = cartInit.replace(/^[ \t]*import '\.\/recurbuy\.js';[ \t]*\n/m, '');
      cartChanged = true;
      report.push("scripts/initializers/cart.js: remove import './recurbuy.js'");
    }

    if (cartChanged && !dryRun) writeText(cartInitPath, cartInit);
  }

  if (removeFiles) {
    const initializerPath = resolvePath(cwd, 'scripts', 'initializers', 'recurbuy.js');
    if (fs.existsSync(initializerPath)) {
      report.push('delete scripts/initializers/recurbuy.js');
      if (!dryRun) fs.unlinkSync(initializerPath);
    }
    warnings.push('blocks/commerce-subscriptions left in place (may be referenced by content)');
  } else {
    warnings.push('scripts/initializers/recurbuy.js kept — pass --remove-files to delete it');
  }

  report.push('Re-run npm run install:dropins after dependency change');

  return { report, warnings };
}
