/**
 * Apply versioned unified diffs to stock Adobe storefront files.
 *
 * Each patch has a stable `id` + monotonic `version` (in the suite manifest).
 * Merchant state (`.recurbuy-eds.json`) records which id@version were applied so
 * `upgrade` can apply only newer patch revisions without re-smearing stock files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readInstallState,
  writeInstallState,
} from './install-state.js';
import { readText, resolvePath, writeText } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PATCHES_ROOT = path.join(__dirname, '..', 'patches');
/** Named after Adobe boilerplate package.json version (see patches/11.0.0/). */
export const DEFAULT_SUITE = '11.0.0';

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
 * @param {Record<string, unknown>} entry
 * @param {number} index
 */
export function normalizePatchEntry(entry, index) {
  const id = String(entry.id || entry.patch || `patch-${index}`).replace(/\.patch$/i, '');
  const version = Number(entry.version) > 0 ? Number(entry.version) : 1;
  return {
    id,
    version,
    file: String(entry.file),
    patch: String(entry.patch),
  };
}

/**
 * Lines the unified diff would insert (`+…`, not `+++` headers).
 * Used to see if the patch effect is already present in the target file —
 * no separate `detect` markers in the manifest.
 * @param {string} patchText
 * @returns {string[]}
 */
export function plusLinesFromPatch(patchText) {
  const out = [];
  for (const line of patchText.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(line.slice(1));
    }
  }
  return out;
}

/**
 * True when every inserted line from the patch already appears in `source`.
 * @param {string} source
 * @param {string} patchText
 */
export function patchEffectPresent(source, patchText) {
  const plus = plusLinesFromPatch(patchText);
  if (!plus.length) return false;
  return plus.every((line) => source.includes(line));
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
    while (i < rawLines.length && (oldSeen < oldCount || newSeen < newCount)) {
      const line = rawLines[i];
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
        break;
      }
      if (line.startsWith('\\')) {
        i += 1;
        continue;
      }
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
 * Decide whether a patch needs work.
 * "Already applied" is inferred from the `.patch` file (`+` lines present in source).
 * @param {{
 *   entry: ReturnType<typeof normalizePatchEntry>,
 *   source: string,
 *   patchText: string,
 *   recorded: { version: number } | undefined,
 *   mode: 'init' | 'upgrade' | 'repatch',
 * }} args
 * @returns {'skip-current' | 'mark-only' | 'apply'}
 */
export function decidePatchAction(args) {
  const {
    entry, source, patchText, recorded, mode,
  } = args;
  const looksPatched = patchEffectPresent(source, patchText);
  const recordedVer = recorded ? Number(recorded.version) || 0 : 0;

  if (mode === 'repatch') {
    return looksPatched ? 'mark-only' : 'apply';
  }

  // Newer patch revision for this id → always try to apply (patch file is the delta).
  if (recordedVer < entry.version && recorded) {
    return 'apply';
  }

  if (recordedVer >= entry.version) {
    return 'skip-current';
  }

  if (looksPatched) {
    // First run: stock already has our lines (manual or prior install) — record only.
    return 'mark-only';
  }

  return 'apply';
}

/**
 * Pending patch ids where recorded version < manifest version (or missing),
 * regardless of file content — used by doctor / upgrade summary.
 * @param {string} suite
 * @param {ReturnType<typeof readInstallState>} state
 */
export function listPendingPatches(suite, state) {
  const manifest = loadManifest(suite);
  if (!manifest) return [];
  const applied = state?.appliedPatches || {};
  const pending = [];
  (manifest.patches || []).forEach((raw, index) => {
    const entry = normalizePatchEntry(raw, index);
    const rec = applied[entry.id];
    const ver = rec ? Number(rec.version) || 0 : 0;
    if (ver < entry.version) {
      pending.push({
        id: entry.id,
        from: ver,
        to: entry.version,
        file: entry.file,
      });
    }
  });
  return pending;
}

/**
 * @param {{
 *   cwd: string,
 *   suite?: string,
 *   dryRun?: boolean,
 *   mode?: 'init' | 'upgrade' | 'repatch',
 * }} options
 * @returns {{
 *   report: string[],
 *   warnings: string[],
 *   suite: string,
 *   failed: boolean,
 *   appliedPatches: Record<string, { id: string, version: number, file: string, appliedAt: string }>,
 *   changed: boolean,
 * }}
 */
export function applySuitePatches(options) {
  const {
    cwd,
    dryRun = false,
    mode = 'init',
  } = options;
  const suite = options.suite || DEFAULT_SUITE;
  const report = [];
  const warnings = [];
  const manifest = loadManifest(suite);
  const prevState = readInstallState(cwd);
  /** @type {Record<string, { id: string, version: number, file: string, appliedAt: string }>} */
  const appliedPatches = { ...(prevState?.appliedPatches || {}) };

  if (!manifest) {
    const available = listSuites().join(', ') || '(none)';
    return {
      report,
      warnings: [`No patches for suite "${suite}". Available: ${available}`],
      suite,
      failed: true,
      appliedPatches,
      changed: false,
    };
  }

  report.push(`suite patches: ${suite} (mode=${mode})`);
  let failed = false;
  let changed = false;
  const now = new Date().toISOString();

  (manifest.patches || []).forEach((raw, index) => {
    const entry = normalizePatchEntry(raw, index);
    const targetPath = resolvePath(cwd, entry.file);
    if (!fs.existsSync(targetPath)) {
      warnings.push(`${entry.id}: ${entry.file} missing — add RecurBuy changes manually (see README)`);
      failed = true;
      return;
    }

    const patchPath = path.join(manifest.dir, entry.patch);
    if (!fs.existsSync(patchPath)) {
      warnings.push(`${entry.id}: patch file missing (${entry.patch})`);
      failed = true;
      return;
    }

    const patchText = readText(patchPath);
    const current = readText(targetPath);
    const recorded = appliedPatches[entry.id];
    const action = decidePatchAction({
      entry,
      source: current,
      patchText,
      recorded,
      mode,
    });

    if (action === 'skip-current') {
      report.push(`${entry.id}@${entry.version}: up to date (${entry.file})`);
      return;
    }

    if (action === 'mark-only') {
      appliedPatches[entry.id] = {
        id: entry.id,
        version: entry.version,
        file: entry.file,
        appliedAt: recorded?.appliedAt || now,
      };
      report.push(`${entry.id}@${entry.version}: already in file — recorded in ${STATE_HINT}`);
      changed = true;
      return;
    }

    // action === 'apply'
    const applied = applyUnifiedDiff(patchText, targetPath);
    if (!applied.ok) {
      if (patchEffectPresent(current, patchText)) {
        appliedPatches[entry.id] = {
          id: entry.id,
          version: entry.version,
          file: entry.file,
          appliedAt: recorded?.appliedAt || now,
        };
        changed = true;
        warnings.push(
          `${entry.id}@${entry.version}: could not re-diff (${applied.error}); `
          + 'patch +lines already in file — state updated. If this release needed new stock '
          + 'lines, update the .patch (delta against current stock) and bump version.',
        );
        return;
      }
      warnings.push(`${entry.id}: patch failed on ${entry.file} — ${applied.error}`);
      warnings.push('  Align stock files to the theme version, or apply lines from README.');
      failed = true;
      return;
    }

    report.push(`${entry.id}@${entry.version}: applied → ${entry.file}`);
    changed = true;
    if (!dryRun) writeText(targetPath, applied.source);
    appliedPatches[entry.id] = {
      id: entry.id,
      version: entry.version,
      file: entry.file,
      appliedAt: now,
    };
  });

  if (!failed) {
    writeInstallState(cwd, { suite, appliedPatches }, { dryRun });
    if (!dryRun) {
      report.push(`state: wrote ${STATE_HINT} (suite=${suite})`);
    } else {
      report.push(`state: would write ${STATE_HINT} (suite=${suite})`);
    }
  }

  return {
    report, warnings, suite, failed, appliedPatches, changed,
  };
}

const STATE_HINT = '.recurbuy-eds.json';
