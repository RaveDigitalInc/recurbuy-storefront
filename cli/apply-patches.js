/**
 * Apply versioned unified diffs to stock Adobe storefront files.
 * Prefer explicit patches over regex rewrites of head.html / build.mjs / cart.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText, resolvePath, writeText } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PATCHES_ROOT = path.join(__dirname, '..', 'patches');
export const DEFAULT_SUITE = 'b2c-september-2026';

/**
 * @param {string} [suite]
 */
export function listSuites() {
  if (!fs.existsSync(PATCHES_ROOT)) return [];
  return fs.readdirSync(PATCHES_ROOT).filter((name) => {
    const dir = path.join(PATCHES_ROOT, name);
    return fs.statSync(dir).isDirectory()
      && fs.existsSync(path.join(dir, 'manifest.json'));
  });
}

/**
 * @param {string} suite
 */
export function loadManifest(suite) {
  const dir = path.join(PATCHES_ROOT, suite);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const data = JSON.parse(readText(manifestPath));
  return { dir, ...data };
}

/**
 * Apply one unified diff (single-file, --- a/ +++ b/) to absolute target path.
 * @param {string} patchText
 * @param {string} targetPath
 * @returns {{ ok: boolean, source?: string, error?: string }}
 */
export function applyUnifiedDiff(patchText, targetPath) {
  const original = readText(targetPath);
  const lines = original.split('\n');
  const hunks = parseHunks(patchText);
  if (hunks.length === 0) {
    return { ok: false, error: 'patch has no hunks' };
  }

  let offset = 0;
  for (const hunk of hunks) {
    const result = applyHunk(lines, hunk, offset);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    offset = result.nextOffset;
  }

  return { ok: true, source: lines.join('\n') };
}

/**
 * @param {string} patchText
 */
function parseHunks(patchText) {
  const hunks = [];
  const rawLines = patchText.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < rawLines.length) {
    const header = rawLines[i].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!header) {
      i += 1;
      continue;
    }
    const oldStart = Number(header[1]);
    const oldCount = header[2] === undefined ? 1 : Number(header[2]);
    const newCount = header[4] === undefined ? 1 : Number(header[4]);
    i += 1;
    const hunkLines = [];
    let oldSeen = 0;
    let newSeen = 0;
    // Stop at hunk line counts — a trailing '' from split('\\n') must not become
    // an extra blank context line after the last real hunk line.
    while (i < rawLines.length && (oldSeen < oldCount || newSeen < newCount)) {
      const line = rawLines[i];
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
        break;
      }
      if (line.startsWith('\\')) {
        i += 1;
        continue;
      }
      // Blank line in the patch file = context blank (leading space omitted).
      const normalized = line === '' ? ' ' : line;
      const tag = normalized[0];
      if (tag === ' ') {
        oldSeen += 1;
        newSeen += 1;
      } else if (tag === '-') {
        oldSeen += 1;
      } else if (tag === '+') {
        newSeen += 1;
      } else {
        break;
      }
      hunkLines.push(normalized);
      i += 1;
    }
    hunks.push({ oldStart, oldCount, lines: hunkLines });
  }
  return hunks;
}

/**
 * @param {string[]} lines
 * @param {{ oldStart: number, oldCount: number, lines: string[] }} hunk
 * @param {number} offset
 */
function applyHunk(lines, hunk, offset) {
  const expected = [];
  const replacement = [];
  for (const line of hunk.lines) {
    const tag = line[0];
    const body = line.slice(1);
    if (tag === ' ') {
      expected.push(body);
      replacement.push(body);
    } else if (tag === '-') {
      expected.push(body);
    } else if (tag === '+') {
      replacement.push(body);
    }
  }

  // unified diff oldStart is 1-based; search near that point first, then full file
  const prefer = Math.max(0, hunk.oldStart - 1 + offset);
  const at = findSequence(lines, expected, prefer);
  if (at < 0) {
    return {
      ok: false,
      error: `context not found for hunk at -${hunk.oldStart} (file may differ from suite)`,
    };
  }

  lines.splice(at, expected.length, ...replacement);
  return {
    ok: true,
    nextOffset: offset + (replacement.length - expected.length),
  };
}

/**
 * @param {string[]} haystack
 * @param {string[]} needle
 * @param {number} prefer
 */
function findSequence(haystack, needle, prefer) {
  if (needle.length === 0) return prefer;
  const tryAt = (start) => {
    if (start < 0 || start + needle.length > haystack.length) return false;
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) return false;
    }
    return true;
  };
  if (tryAt(prefer)) return prefer;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (tryAt(start)) return start;
  }
  return -1;
}

/**
 * @param {{ cwd: string, suite?: string, dryRun?: boolean }} options
 * @returns {{ report: string[], warnings: string[], suite: string, failed: boolean }}
 */
export function applySuitePatches(options) {
  const { cwd, dryRun = false } = options;
  const suite = options.suite || DEFAULT_SUITE;
  const report = [];
  const warnings = [];
  const manifest = loadManifest(suite);

  if (!manifest) {
    const available = listSuites().join(', ') || '(none)';
    return {
      report,
      warnings: [`No patches for suite "${suite}". Available: ${available}`],
      suite,
      failed: true,
    };
  }

  report.push(`suite patches: ${suite}`);
  let failed = false;

  for (const entry of manifest.patches || []) {
    const targetPath = resolvePath(cwd, entry.file);
    if (!fs.existsSync(targetPath)) {
      warnings.push(`${entry.file}: missing — add RecurBuy changes manually (see README)`);
      failed = true;
      continue;
    }

    const current = readText(targetPath);
    if (entry.alreadyAppliedNeedle && current.includes(entry.alreadyAppliedNeedle)) {
      report.push(`${entry.file}: already patched`);
      continue;
    }

    const patchPath = path.join(manifest.dir, entry.patch);
    if (!fs.existsSync(patchPath)) {
      warnings.push(`${entry.patch}: patch file missing in package`);
      failed = true;
      continue;
    }

    const applied = applyUnifiedDiff(readText(patchPath), targetPath);
    if (!applied.ok) {
      warnings.push(`${entry.file}: patch failed — ${applied.error}`);
      warnings.push('  Add the RecurBuy lines manually (README) or use a matching boilerplate suite.');
      failed = true;
      continue;
    }

    report.push(`${entry.file}: applied ${entry.patch}`);
    if (!dryRun) writeText(targetPath, applied.source);
  }

  return {
    report, warnings, suite, failed,
  };
}
