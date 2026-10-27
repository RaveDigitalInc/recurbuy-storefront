#!/usr/bin/env node
/**
 * Self-check for sidebar-fragment merge (no network).
 */
import assert from 'node:assert/strict';
import {
  ensureSubscriptionsSidebarItem,
  removeSubscriptionsSidebarItem,
  sidebarHasSubscriptionsLink,
  SUBSCRIPTIONS_PATH,
} from '../cli/sidebar-fragment.js';
import { parseFstabMount, parseGithubRemote, resolveDaSite } from '../cli/da-site.js';

const sample = `<div>
  <ol>
    <li>
      <p>Orders</p>
      <ol>
        <li>Track</li>
        <li>/customer/orders</li>
        <li>Order</li>
      </ol>
    </li>
  </ol>
</div>`;

assert.equal(sidebarHasSubscriptionsLink(sample), false);
const once = ensureSubscriptionsSidebarItem(sample);
assert.equal(once.changed, true);
assert.equal(sidebarHasSubscriptionsLink(once.html), true);
assert.ok(once.html.includes(SUBSCRIPTIONS_PATH));
assert.ok(once.html.includes('/customer/orders'));

const twice = ensureSubscriptionsSidebarItem(once.html);
assert.equal(twice.changed, false);

const removed = removeSubscriptionsSidebarItem(once.html);
assert.equal(removed.changed, true);
assert.equal(sidebarHasSubscriptionsLink(removed.html), false);
assert.ok(removed.html.includes('/customer/orders'), 'must keep other menu items');

const removedAgain = removeSubscriptionsSidebarItem(removed.html);
assert.equal(removedAgain.changed, false);

assert.deepEqual(
  parseGithubRemote('git@github.com:RaveDigitalInc/recurbuy-eds.git'),
  { org: 'RaveDigitalInc', repo: 'recurbuy-eds' },
);
assert.deepEqual(
  parseFstabMount('mountpoints:\n  /: https://main--shop--acme.aem.live/'),
  { branch: 'main', repo: 'shop', org: 'acme' },
);

// resolveDaSite must not invent org/repo from git — require flags/env/fstab
let threw = false;
try {
  resolveDaSite({ cwd: process.cwd() });
} catch {
  threw = true;
}
assert.equal(threw, true);

console.log('check-sidebar-fragment: ok');
