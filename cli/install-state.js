/**
 * Persistent install state for the merchant storefront (`.recurbuy-eds.json`).
 *
 * Tracks Adobe patch suite + which stock-file patches (id@version) were applied,
 * and the RecurBuy package version that last wrote the state — so `upgrade` / `doctor`
 * can detect drift without guessing from git.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, resolvePath, writeText } from './lib.js';

export const STATE_FILE = '.recurbuy-eds.json';
export const STATE_SCHEMA_VERSION = 1;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @returns {{ name: string, version: string }}
 */
export function readPackageIdentity() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

/**
 * @param {string} cwd
 */
export function statePath(cwd) {
  return resolvePath(cwd, STATE_FILE);
}

/**
 * @param {string} cwd
 * @returns {null | {
 *   schemaVersion: number,
 *   suite: string,
 *   packageName: string,
 *   packageVersion: string,
 *   appliedPatches: Record<string, {
 *     id: string,
 *     version: number,
 *     file: string,
 *     appliedAt: string,
 *   }>,
 *   updatedAt: string,
 * }}
 */
export function readInstallState(cwd) {
  const filePath = statePath(cwd);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readText(filePath));
    if (!data || typeof data !== 'object') return null;
    return {
      schemaVersion: Number(data.schemaVersion) || STATE_SCHEMA_VERSION,
      suite: String(data.suite || ''),
      packageName: String(data.packageName || ''),
      packageVersion: String(data.packageVersion || ''),
      appliedPatches: data.appliedPatches && typeof data.appliedPatches === 'object'
        ? data.appliedPatches
        : {},
      updatedAt: String(data.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} cwd
 * @param {{
 *   suite: string,
 *   appliedPatches: Record<string, { id: string, version: number, file: string, appliedAt: string }>,
 * }} partial
 * @param {{ dryRun?: boolean }} [opts]
 */
export function writeInstallState(cwd, partial, opts = {}) {
  const identity = readPackageIdentity();
  const prev = readInstallState(cwd) || {};
  const next = {
    schemaVersion: STATE_SCHEMA_VERSION,
    suite: partial.suite,
    packageName: identity.name,
    packageVersion: identity.version,
    appliedPatches: partial.appliedPatches,
    updatedAt: new Date().toISOString(),
    // keep unknown keys out — explicit schema only
  };
  if (opts.dryRun) return next;
  writeText(statePath(cwd), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * @param {string} cwd
 * @param {{ dryRun?: boolean }} [opts]
 */
export function removeInstallState(cwd, opts = {}) {
  const filePath = statePath(cwd);
  if (!fs.existsSync(filePath)) return false;
  if (!opts.dryRun) fs.unlinkSync(filePath);
  return true;
}

/**
 * Compare semver-ish strings (major.minor.patch); non-numeric → string compare.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.+-]/).map((p) => Number.parseInt(p, 10));
  const pb = String(b || '0').split(/[.+-]/).map((p) => Number.parseInt(p, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
