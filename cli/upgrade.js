/**
 * Upgrade an existing RecurBuy EDS install after bumping the npm package.
 *
 * - Applies pending stock-file patches (id@version) for the target suite
 * - Refreshes block / initializer templates when missing or --refresh-templates
 * - Does NOT re-publish DA content (run publish-content only if Account pages change)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySuitePatches,
  listPendingPatches,
  loadManifest,
} from './apply-patches.js';
import {
  compareVersions,
  readInstallState,
  readPackageIdentity,
} from './install-state.js';
import { readText, resolvePath, writeText } from './lib.js';
import { runEnsureStorefrontExtras } from './storefront-extras.js';
import { resolveSuite } from './suite-resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

/**
 * @param {{
 *   cwd: string,
 *   dryRun?: boolean,
 *   suite?: string,
 *   repatch?: boolean,
 *   refreshTemplates?: boolean,
 * }} options
 */
export function runUpgrade(options) {
  const {
    cwd,
    dryRun = false,
    repatch = false,
    refreshTemplates = false,
  } = options;

  const report = [];
  const warnings = [];
  const identity = readPackageIdentity();
  const prev = readInstallState(cwd);

  const resolved = resolveSuite({ cwd, explicitSuite: options.suite });
  const { suite } = resolved;
  report.push(`suite: ${suite} (${resolved.source})`);
  if (resolved.warning) warnings.push(resolved.warning);

  report.push(`package: ${identity.name}@${identity.version}`);
  if (prev?.packageVersion) {
    const cmp = compareVersions(identity.version, prev.packageVersion);
    if (cmp === 0) {
      report.push(`state: already at package ${prev.packageVersion}`);
    } else if (cmp > 0) {
      report.push(`state: upgrading package ${prev.packageVersion} → ${identity.version}`);
    } else {
      warnings.push(
        `Installed package ${identity.version} is older than state ${prev.packageVersion} — did you bump the dependency?`,
      );
    }
    if (prev.suite && prev.suite !== suite) {
      report.push(`suite: switching ${prev.suite} → ${suite}`);
    }
  } else {
    report.push('state: no .recurbuy-eds.json yet (first upgrade will create it)');
  }

  if (!loadManifest(suite)) {
    return {
      report,
      warnings: [
        ...warnings,
        `Unknown suite "${suite}". Available suites are listed in: npx recurbuy-eds help`,
      ],
      failed: true,
    };
  }

  const pendingBefore = listPendingPatches(suite, prev);
  if (!repatch && pendingBefore.length === 0 && prev?.suite === suite) {
    report.push('stock patches: none pending for this suite');
  } else if (!repatch && pendingBefore.length) {
    report.push(
      `stock patches pending: ${pendingBefore.map((p) => `${p.id} ${p.from}→${p.to}`).join(', ')}`,
    );
  }

  const mode = repatch ? 'repatch' : 'upgrade';
  const patched = applySuitePatches({
    cwd, suite, dryRun, mode,
  });
  patched.report.forEach((line) => report.push(line));
  patched.warnings.forEach((line) => warnings.push(line));

  // Templates: create if missing; overwrite only with --refresh-templates
  const initPath = resolvePath(cwd, 'scripts', 'initializers', 'recurbuy.js');
  const initTemplate = path.join(TEMPLATES, 'initializers', 'recurbuy.js');
  if (fs.existsSync(initTemplate)) {
    if (!fs.existsSync(initPath)) {
      report.push('scripts/initializers/recurbuy.js: create');
      if (!dryRun) writeText(initPath, readText(initTemplate));
    } else if (refreshTemplates) {
      report.push('scripts/initializers/recurbuy.js: refresh (--refresh-templates)');
      if (!dryRun) writeText(initPath, readText(initTemplate));
    } else {
      report.push('scripts/initializers/recurbuy.js: keep (pass --refresh-templates to overwrite)');
    }
  }

  const blockDest = resolvePath(cwd, 'blocks', 'commerce-subscriptions');
  const blockSrc = path.join(TEMPLATES, 'blocks', 'commerce-subscriptions');
  const blockEntry = path.join(blockDest, 'commerce-subscriptions.js');
  if (fs.existsSync(path.join(blockSrc, 'commerce-subscriptions.js'))) {
    if (!fs.existsSync(blockEntry)) {
      report.push('blocks/commerce-subscriptions: create');
      if (!dryRun) {
        fs.mkdirSync(path.dirname(blockDest), { recursive: true });
        fs.cpSync(blockSrc, blockDest, { recursive: true });
      }
    } else if (refreshTemplates) {
      report.push('blocks/commerce-subscriptions: refresh (--refresh-templates)');
      if (!dryRun) fs.cpSync(blockSrc, blockDest, { recursive: true });
    } else {
      report.push('blocks/commerce-subscriptions: keep');
    }
  }

  const extras = runEnsureStorefrontExtras({ cwd, dryRun });
  extras.report.forEach((line) => report.push(line));
  extras.warnings.forEach((line) => warnings.push(line));

  report.push('');
  report.push('Next:');
  report.push('  1. npm run install:dropins   # vendor the new package into scripts/__dropins__');
  report.push('  2. npx recurbuy-eds doctor --org=… --repo=…');
  report.push('  3. Re-run publish-content only if this release changed Account page/menu templates');

  return {
    report,
    warnings,
    failed: patched.failed,
  };
}
