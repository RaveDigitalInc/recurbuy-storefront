/**
 * Storefront extras for `init` / `uninstall`.
 *
 * RecurBuy no longer text-patches stock Adobe `decorate()` bodies.
 * Behavior ships in the package (FetchGraphQL hooks, auto-mount, cart UI runtime).
 * This file only: Account page stubs (list + scaffolds) and config key placeholders.
 */

import fs from 'node:fs';
import path from 'node:path';
import { listAllSubscriptionContentDocuments } from './account-pages.js';
import {
  REQUIRED_CONFIG_KEYS, readText, resolvePath, writeText,
} from './lib.js';

/**
 * Content + config only. Used by `init`.
 * @param {{ cwd: string, dryRun?: boolean }} options
 */
export function runEnsureStorefrontExtras(options) {
  const { cwd, dryRun = false } = options;
  const report = [];
  const warnings = [];
  const ctx = {
    cwd, dryRun, report, warnings,
  };
  ensureSubscriptionsContent(cwd, ctx);
  ensureConfigKeys(cwd, ctx);
  return { report, warnings };
}

function ensureSubscriptionsContent(cwd, ctx) {
  const preferCustomerRoot = fs.existsSync(resolvePath(cwd, 'customer'));
  const destRoot = preferCustomerRoot
    ? resolvePath(cwd, 'customer')
    : resolvePath(cwd, 'content', 'customer');

  for (const doc of listAllSubscriptionContentDocuments()) {
    // DA path is e.g. customer/subscriptions/detail.html → relative under customer/
    const relativeUnderCustomer = doc.daPath.replace(/^customer\//, '');
    const dest = path.join(destRoot, relativeUnderCustomer);
    const altDest = preferCustomerRoot
      ? resolvePath(cwd, 'content', 'customer', relativeUnderCustomer)
      : resolvePath(cwd, 'customer', relativeUnderCustomer);

    if (fs.existsSync(dest) || fs.existsSync(altDest)) {
      ctx.report.push(`${doc.docPath}: already present`);
      continue;
    }

    if (!fs.existsSync(doc.templateFile)) {
      ctx.warnings.push(`${path.basename(doc.templateFile)} template missing in package`);
      continue;
    }

    ctx.report.push(`${path.relative(cwd, dest)}: create`);
    if (!ctx.dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(doc.templateFile, dest);
    }
  }
}

function ensureConfigKeys(cwd, ctx) {
  if (!fs.existsSync(resolvePath(cwd, 'config.json'))) {
    ctx.warnings.push('config.json not found — copy demo-config.json to config.json, then run init again');
  }

  for (const name of ['config.json', 'config.example.json']) {
    const filePath = resolvePath(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = JSON.parse(readText(filePath));
      const target = data.public?.default || data.default;
      if (!target || typeof target !== 'object') {
        ctx.warnings.push(`${name}: no public.default — add subscriptions-* keys manually`);
        continue;
      }
      let changed = false;
      for (const key of Object.keys(REQUIRED_CONFIG_KEYS)) {
        if (!(key in target)) {
          target[key] = '';
          changed = true;
        }
      }
      if (changed) {
        ctx.report.push(`${name}: add subscriptions-* placeholder keys`);
        if (!ctx.dryRun) writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
      } else {
        ctx.report.push(`${name}: subscriptions-* keys present`);
      }
    } catch {
      ctx.warnings.push(`${name}: invalid JSON`);
    }
  }
}
