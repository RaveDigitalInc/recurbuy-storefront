/**
 * Copy RecurBuy EDS block templates into the merchant storefront.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePath } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

/** Block folder names under templates/blocks + storefront blocks/. */
export const RECURBUY_BLOCK_NAMES = [
  'commerce-subscriptions',
  'commerce-subscription-account',
];

/**
 * @param {{
 *   cwd: string,
 *   dryRun?: boolean,
 *   refresh?: boolean,
 *   keepLabel?: string,
 *   report: string[],
 *   warnings: string[],
 * }} ctx
 */
export function ensureRecurBuyBlocks(ctx) {
  const {
    cwd,
    dryRun = false,
    refresh = false,
    keepLabel = 'already exists',
    report,
    warnings,
  } = ctx;

  for (const name of RECURBUY_BLOCK_NAMES) {
    const blockDest = resolvePath(cwd, 'blocks', name);
    const blockSrc = path.join(TEMPLATES, 'blocks', name);
    const entry = path.join(blockDest, `${name}.js`);
    const srcEntry = path.join(blockSrc, `${name}.js`);

    if (!fs.existsSync(srcEntry)) {
      warnings.push(`package template missing: ${blockSrc} — reinstall @dropins/storefront-recurbuy`);
      continue;
    }

    if (!fs.existsSync(entry)) {
      report.push(`blocks/${name}: create`);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(blockDest), { recursive: true });
        fs.cpSync(blockSrc, blockDest, { recursive: true });
        if (!fs.existsSync(entry)) {
          warnings.push(`blocks/${name} copy failed — check disk permissions and re-run init`);
        }
      }
    } else if (refresh) {
      report.push(`blocks/${name}: refresh (--refresh-templates)`);
      if (!dryRun) fs.cpSync(blockSrc, blockDest, { recursive: true });
    } else {
      report.push(`blocks/${name}: ${keepLabel}`);
    }
  }
}
