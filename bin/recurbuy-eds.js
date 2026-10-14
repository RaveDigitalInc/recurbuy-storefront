#!/usr/bin/env node
/* eslint-disable no-console */
import { runDoctor } from '../cli/doctor.js';
import { runInit } from '../cli/init.js';
import { runUninstall } from '../cli/uninstall.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';
const cwd = process.cwd();
const dryRun = args.includes('--dry-run');
const removeFiles = args.includes('--remove-files');

function printHelp() {
  console.log(`RecurBuy EDS CLI

Usage:
  npx recurbuy-eds <command> [options]

Commands:
  init         Scaffold + one stock touch (cart initializer loads RecurBuy)
  doctor       Verify installation
  uninstall    Rollback init (remove cart loader, dependency, import map)
  help         Show this help

Options:
  --dry-run        Print actions without writing files
  --remove-files   With uninstall: delete scripts/initializers/recurbuy.js

Merchant happy path (install and it works — no hand-editing Adobe blocks):
  npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@0.2.0
  npx recurbuy-eds init
  npm run install:dropins
  # fill subscriptions-* in config.json (keys added empty by init)
  npx recurbuy-eds doctor

Product logic lives in the vendored package (hooks + auto-mount).
Stock Adobe blocks are never modified.
`);
}

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'init') {
    const { report, warnings } = runInit({ cwd, dryRun });
    console.log(dryRun ? 'RecurBuy init (dry-run)\n' : 'RecurBuy init\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    return;
  }

  if (command === 'doctor') {
    const result = runDoctor({ cwd });
    console.log('RecurBuy doctor\n');
    result.ok.forEach((line) => console.log(`  ✓ ${line}`));
    result.warn.forEach((line) => console.log(`  ⚠ ${line}`));
    result.fail.forEach((line) => console.log(`  ✗ ${line}`));
    process.exitCode = result.exitCode;
    return;
  }

  if (command === 'uninstall') {
    const { report, warnings } = runUninstall({ cwd, dryRun, removeFiles });
    console.log(dryRun ? 'RecurBuy uninstall (dry-run)\n' : 'RecurBuy uninstall\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
