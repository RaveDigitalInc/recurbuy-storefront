/**
 * Storefront extras for `init` / `uninstall`.
 *
 * RecurBuy no longer text-patches stock Adobe `decorate()` bodies.
 * Behavior ships in the package (FetchGraphQL hooks, auto-mount, cart UI runtime).
 * This file only: subscriptions page stub and config key placeholders.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_CONFIG_KEYS, readText, resolvePath, writeText,
} from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

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
  const candidates = [
    ['customer', 'subscriptions.html'],
    ['content', 'customer', 'subscriptions.html'],
  ];
  const existing = candidates.some((parts) => fs.existsSync(resolvePath(cwd, ...parts)));
  if (existing) {
    ctx.report.push('subscriptions page: already present');
    return;
  }

  const destDir = fs.existsSync(resolvePath(cwd, 'customer'))
    ? resolvePath(cwd, 'customer')
    : resolvePath(cwd, 'content', 'customer');
  const template = path.join(TEMPLATES, 'content', 'subscriptions.html');
  if (!fs.existsSync(template)) {
    ctx.warnings.push('subscriptions.html template missing in package');
    return;
  }
  const dest = path.join(destDir, 'subscriptions.html');
  ctx.report.push(`${path.relative(cwd, dest)}: create`);
  if (!ctx.dryRun) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(template, dest);
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
