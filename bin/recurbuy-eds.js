#!/usr/bin/env node
/* eslint-disable no-console */
import { runDoctor } from '../cli/doctor.js';
import { runInit } from '../cli/init.js';
import { runPublishContent } from '../cli/publish-content.js';
import { runUninstall } from '../cli/uninstall.js';
import { runUnpublishContent } from '../cli/unpublish-content.js';
import { runUpgrade } from '../cli/upgrade.js';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h') || args[0] === 'help';
const command = wantsHelp ? 'help' : (args[0] || 'help');
const cwd = process.cwd();
const dryRun = args.includes('--dry-run');
const removeFiles = args.includes('--remove-files');
const forceLogin = args.includes('--login');
const skipPublish = args.includes('--skip-publish');
const skipSidebar = args.includes('--skip-sidebar');
const skipContent = args.includes('--skip-content');
const repatch = args.includes('--repatch');
const refreshTemplates = args.includes('--refresh-templates');
const suiteArg = args.find((a) => a.startsWith('--suite='));
const suite = suiteArg ? suiteArg.slice('--suite='.length) : undefined;
const flagValue = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};

function printHelp() {
  console.log(`RecurBuy EDS CLI

Usage:
  npx recurbuy-eds <command> [options]

Commands:
  init               First-time scaffold + patches + templates (writes .recurbuy-eds.json)
  upgrade            After bumping the npm package: apply pending patches, refresh state
  publish-content    Upload subscriptions page + Account sidebar to da.live, then preview/publish
  unpublish-content  Remove DA page + sidebar link, unpublish from aem.live (before uninstall)
  doctor             Verify code install, patch state, and live Account content
  uninstall          Rollback init (code only — does not delete DA pages)
  help               Show this help

Options:
  --dry-run              Print actions without writing / calling DA
  --remove-files         With uninstall: delete initializer, block, vendored drop-in
  --repatch              Re-evaluate stock patches (init/upgrade)
  --refresh-templates    With upgrade: overwrite recurbuy.js + commerce-subscriptions from package
  --org=ORG              DA org from da.live (else DA_ORG / fstab.yaml)
  --repo=REPO            DA repo from da.live (else DA_REPO / fstab.yaml)
  --branch=BRANCH        EDS branch (default main; else DA_BRANCH)
  --login                Force browser IMS login (clears cached DA tokens)
  --skip-publish         Skip admin.hlx.page preview/live (or unpublish) steps
  --skip-sidebar         Do not modify customer/sidebar-fragment
  --skip-content         With doctor: do not probe aem.live for Account page/menu

Install:
  npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@x.y.z
  npx recurbuy-eds init
  npm run install:dropins
  # fill subscriptions-* in config.json
  npx recurbuy-eds publish-content --org=… --repo=…
  npx recurbuy-eds doctor --org=… --repo=…

Upgrade:
  npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@NEWER
  npx recurbuy-eds upgrade
  npm run install:dropins

Remove:
  npx recurbuy-eds unpublish-content --org=… --repo=…
  npx recurbuy-eds uninstall --remove-files

Patches folder matches storefront package.json version (e.g. patches/11.0.0/).
State: .recurbuy-eds.json — commit with the storefront.
Auth for publish/unpublish: DA_TOKEN, ~/.aem/da-token.json, or browser via da-auth-helper.
`);
}

async function main() {
  if (command === 'help') {
    printHelp();
    return;
  }

  if (command === 'init') {
    const { report, warnings, failed } = runInit({
      cwd,
      dryRun,
      suite,
      repatch,
    });
    console.log(dryRun ? 'RecurBuy init (dry-run)\n' : 'RecurBuy init\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    if (failed) process.exitCode = 1;
    return;
  }

  if (command === 'upgrade') {
    const { report, warnings, failed } = runUpgrade({
      cwd,
      dryRun,
      suite,
      repatch,
      refreshTemplates,
    });
    console.log(dryRun ? 'RecurBuy upgrade (dry-run)\n' : 'RecurBuy upgrade\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    if (failed) process.exitCode = 1;
    return;
  }

  if (command === 'doctor') {
    const result = await runDoctor({
      cwd,
      org: flagValue('--org'),
      repo: flagValue('--repo'),
      branch: flagValue('--branch'),
      skipContent,
    });
    console.log('RecurBuy doctor\n');
    result.ok.forEach((line) => console.log(`  ✓ ${line}`));
    result.warn.forEach((line) => console.log(`  ⚠ ${line}`));
    result.fail.forEach((line) => console.log(`  ✗ ${line}`));
    if (result.fixes?.length) {
      console.log('\nHow to fix:');
      result.fixes.forEach((block) => {
        const [label, ...rest] = block.split('\n');
        console.log(`  • ${label}`);
        rest.forEach((line) => console.log(`  ${line}`));
      });
    } else if (result.exitCode === 0) {
      console.log(skipContent
        ? '\nCode checks passed (--skip-content).'
        : '\nAll checks passed (code + live Account content).');
    }
    process.exitCode = result.exitCode;
    return;
  }

  if (command === 'uninstall') {
    const { report, warnings } = runUninstall({ cwd, dryRun, removeFiles });
    console.log(dryRun ? 'RecurBuy uninstall (dry-run)\n' : 'RecurBuy uninstall\n');
    report.forEach((line) => console.log(`  ${line}`));
    const allWarnings = [
      ...warnings,
      'DA Account pages are not removed by uninstall. If you ran publish-content, also run:',
      '  npx recurbuy-eds unpublish-content --org=… --repo=…',
    ];
    console.log('\nWarnings:');
    allWarnings.forEach((line) => console.log(`  ⚠ ${line}`));
    return;
  }

  if (command === 'publish-content') {
    const { report, warnings, failed } = await runPublishContent({
      cwd,
      dryRun,
      forceLogin,
      skipPublish,
      skipSidebar,
      org: flagValue('--org'),
      repo: flagValue('--repo'),
      branch: flagValue('--branch'),
    });
    console.log(dryRun ? 'RecurBuy publish-content (dry-run)\n' : 'RecurBuy publish-content\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    if (failed) process.exitCode = 1;
    return;
  }

  if (command === 'unpublish-content') {
    const { report, warnings, failed } = await runUnpublishContent({
      cwd,
      dryRun,
      forceLogin,
      skipPublish,
      skipSidebar,
      org: flagValue('--org'),
      repo: flagValue('--repo'),
      branch: flagValue('--branch'),
    });
    console.log(dryRun ? 'RecurBuy unpublish-content (dry-run)\n' : 'RecurBuy unpublish-content\n');
    report.forEach((line) => console.log(`  ${line}`));
    if (warnings.length) {
      console.log('\nWarnings:');
      warnings.forEach((line) => console.log(`  ⚠ ${line}`));
    }
    if (failed) process.exitCode = 1;
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
