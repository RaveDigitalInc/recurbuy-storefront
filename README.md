# `@recurbuy/storefront-eds`

RecurBuy **subscription drop-in** for Adobe Commerce Storefront (EDS).

Install so stock Adobe `install:dropins` vendors the package — **do not fork `postinstall.js`**.

**Requires** [aem-boilerplate-commerce](https://github.com/hlxsites/aem-boilerplate-commerce) **v11+** (cart drop-in 3.x): RecurBuy hooks into `CORE_FETCH_GRAPHQL` from `scripts/commerce.js`. Older bases (v3, cart 1.x) are not supported.

RecurBuy is an **add-on**: it only rewrites subscription add-to-cart and paints RecurBuy cart/PDP UI. One-time traffic and host cart lines stay on native Adobe drop-in paths (`createRecurbuyCart` + `CartModel.transformer` + raw GraphQL normaliser). Stock touch points are only the three CLI patches (`head.html`, `build.mjs`, `scripts/initializers/cart.js`).

---

## Two layers

| Layer | Where it lives | Commands |
|-------|----------------|----------|
| **Code** (drop-in, patches, `config.json` keys) | Storefront **git** | `init` / `upgrade` / `uninstall` / `install:dropins` |
| **Account content** (Subscriptions page + Account menu) | **Document Authoring** (da.live) → aem.live | `publish-content` / `unpublish-content` |

`uninstall` never deletes DA pages. `publish-content` never writes RecurBuy panel settings.

RecurBuy panel only needs two browser-safe keys in storefront `config.json` — **no Adobe IMS token** in the panel.

---

## Quick install (happy path)

From the **merchant storefront root** (not this package repo):

```bash
# 1) Alias (published name stays @recurbuy/storefront-eds)
npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@0.2.0

# 2) Stock patches + templates + .recurbuy-eds.json
npx recurbuy-eds init

# 3) Vendor into scripts/__dropins__/
npm run install:dropins

# 4) Fill config.json → public.default (see Config below)
#    subscriptions-storefront-url
#    subscriptions-connection-token

# 5) Account page + menu on da.live / aem.live
npx recurbuy-eds publish-content --org=YOUR_ORG --repo=YOUR_REPO --branch=main

# 6) Verify
npx recurbuy-eds doctor --org=YOUR_ORG --repo=YOUR_REPO
```

Local tarball (before registry publish):

```bash
npm pack                         # in this package repository
npm install "@dropins/storefront-recurbuy@file:/path/to/recurbuy-storefront-eds-0.2.0.tgz"
```

Panel side (separate): Connection + AccS webhooks + subscription options on products.

---

## What to do in which situation

| Situation | What to run |
|-----------|-------------|
| **First install** | `init` → `install:dropins` → fill `config.json` → `publish-content` → `doctor` |
| **New RecurBuy package** (same theme version) | bump alias → `npm install` → `upgrade` → `install:dropins` → `doctor`. Re-run `publish-content` only if Account templates changed |
| **Adobe theme upgraded** (e.g. `11.0.0` → `12.0.0`) | install RecurBuy with `patches/12.0.0/` → `upgrade` → `install:dropins` — [details](#when-the-theme-goes-11--12) |
| **Force re-check stock files** | `upgrade --repatch` |
| **Overwrite block / initializer templates** | `upgrade --refresh-templates` |
| **Patch failed** | Align stock to the theme version, or [manual lines](#manual-fallback-stock-files); then `doctor` |
| **Dry-run Account publish** | `publish-content --dry-run --org=… --repo=…` |
| **DA OK, Edge publish fails** | `publish-content --skip-publish`, then Publish in Sidekick / DA; fix Edge User Admin |
| **IMS token expired** | `publish-content --login --org=… --repo=…` |
| **Refresh page only** | `publish-content --skip-sidebar …` |
| **Remove RecurBuy completely** | `unpublish-content` then `uninstall --remove-files` |
| **Remove code only** | `uninstall --remove-files` (DA content stays) |
| **Doctor without live Account check** | `doctor --skip-content` |

---

## Config values (not code)

`config.json` is the merchant storefront’s (boilerplate ships `demo-config.json` — copy to `config.json` first). The package never changes Commerce endpoints; `init` only adds **two** keys under `public.default`:

| Key | Value |
|-----|-------|
| `subscriptions-storefront-url` | URL of your RecurBuy panel |
| `subscriptions-connection-token` | **storefront** token of this store’s Connection (public JWT) |

The panel resolves store view / website from the token. `config.json` is public on Edge Delivery — never put a merchant API token here.

`publish-content` does not use these keys; the shopper Account page does (subscriptions API).

---

## Account page + menu (`publish-content`)

### Why a separate command

Drop-in code is in **git**. The «My Subscriptions» page and the Account sidebar item live in **Document Authoring** — they are not in the storefront git repo.

`publish-content` will:

1. Authenticate you to Adobe IMS (browser), unless a token is already cached / set
2. Upload `customer/subscriptions.html` to DA
3. Add a **Subscriptions** row to `customer/sidebar-fragment` (idempotent — no duplicate if the link exists)
4. Preview + publish on Edge Delivery (`aem.page` / `aem.live`)

Run from the **storefront root**, after `init` + `install:dropins` (+ filled config for a working list page).

```bash
# Safe rehearsal
npx recurbuy-eds publish-content --dry-run --org=YOUR_ORG --repo=YOUR_REPO --branch=main

# Real run (browser login if needed)
npx recurbuy-eds publish-content --org=YOUR_ORG --repo=YOUR_REPO --branch=main
```

On success the CLI prints `edit` / `preview` / `live` URLs. Open **live** as a logged-in shopper and confirm the Account menu link.

### Flags

| Flag | Meaning |
|------|---------|
| `--org` / `--repo` / `--branch` | DA site + EDS branch (default branch `main`) |
| `--dry-run` | No DA writes / no publish; print what would happen |
| `--login` | Clear cached tokens and open IMS login again |
| `--skip-publish` | Upload to DA only (no admin.hlx.page preview/live) |
| `--skip-sidebar` | Do not touch `customer/sidebar-fragment` |
| `-h` / `help` | CLI help |

### How org / repo are resolved (if flags omitted)

1. `--org` / `--repo` / `--branch`
2. Env: `DA_ORG`, `DA_REPO`, `DA_BRANCH` (or `AEM_*`)
3. `fstab.yaml` in the storefront (URL like `https://main--repo--org.aem.live`)

**Git origin is not used** — code repo and DA content site are often different.

### How to find `--org` and `--repo`

**A — da.live (preferred)**  
1. Open [https://da.live](https://da.live) as a site author  
2. Open your project  
3. Read the URL: `https://da.live/#/{org}/{repo}/…`  
   Example: `…#/RaveDigitalInc/recurbuy-eds/customer/…` → `--org=RaveDigitalInc --repo=recurbuy-eds`

**B — live shop URL**  
Pattern: `https://{branch}--{repo}--{org}.aem.live/…`  
Example: `https://main--recurbuy-eds--RaveDigitalInc.aem.live/customer/account`

**C — Site Creator**  
Same org/repo you used when the EDS site was created.

You should be able to **edit** pages under that site in da.live. Read-only / 404 → wrong account or wrong `{org}/{repo}`.

### Auth (Adobe — not RecurBuy)

| Source | When |
|--------|------|
| `DA_TOKEN` env | CI / one-off |
| `<storefront>/.hlx/.da-token.json` | Already used `aem content …` |
| `~/.aem/da-token.json` | Normal CLI / da-auth-helper cache |
| Browser IMS | No valid cache → helper opens login |

Tokens are short-lived (~1 day). Expired → `--login` or delete `~/.aem/da-token.json`.

### Permissions your Adobe ID needs

| Action | Where |
|--------|--------|
| Read/write DA Source | [da.live/config](https://da.live/config) → org → `write` on `/ + **` or `/your-repo/**` |
| Preview / publish Edge | [User Admin](https://tools.aem.live/tools/user-admin/index.html) — email with preview/publish |

Admin must grant the **Adobe ID email** used in the CLI browser login (not the RecurBuy panel user). After permission changes: sign out of Adobe and re-run with `--login`.

### What lands in DA

| Path | Purpose |
|------|---------|
| `customer/subscriptions.html` | Account page (sidebar column + `commerce-subscriptions` block) |
| `customer/sidebar-fragment.html` | Account menu; adds link to `/customer/subscriptions` |

Template in the package: `templates/content/subscriptions.html`.

### Step-by-step (human)

1. `doctor` is green on package / import map / patches (or fix those first)
2. Copy `{org}` / `{repo}` from da.live
3. `publish-content --dry-run …` — printed `site:` must match da.live
4. Run without `--dry-run`; finish browser «Login successful» if prompted
5. Open printed `live:` URL as a shopper; check menu + list
6. Page in DA but missing on live → Edge publish rights, or re-run without `--skip-publish`

### `publish-content` troubleshooting

#### `DA PUT … → 403`

Logged in, but **no write** (often no read either) on that DA site.

1. Open `https://da.live/#/{org}/{repo}` with the **same** Adobe ID — library must open
2. Admin: `https://da.live/config#/{org}/` → permissions → your email/group with `write`
3. `npx recurbuy-eds publish-content --login --org=… --repo=…`
4. Quick check (expect **200**):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(jq -r .access_token ~/.aem/da-token.json)" \
  "https://admin.da.live/list/YOUR_ORG/YOUR_REPO"
```

#### `401` on PUT / preview

Token expired or corrupt → `--login`, or delete `~/.aem/da-token.json` and retry.

#### Browser never opens / `da-auth-helper` fails

Headless CI, blocked `npx`, no GUI:

- On a machine with a browser: `npx -y github:adobe-rnd/da-auth-helper token`
- Or: da.live → DevTools → request to `admin.da.live` → copy `Authorization: Bearer …` → `export DA_TOKEN='…'` → re-run `publish-content`

#### Page uploaded, preview/live 401/403

DA edit rights without Edge preview/publish → User Admin (table above), or `--skip-publish` and publish manually in Sidekick / DA.

#### Sidebar warning, page OK

Missing `customer/sidebar-fragment`, no rights, or non-standard markup. In da.live edit `/customer/sidebar-fragment` and add a row like Orders/Addresses:

- Title: `Subscriptions`
- Subtitle: e.g. `Manage your subscriptions`
- Link: `/customer/subscriptions`
- Icon: e.g. `PendingPayment` (any valid account sidebar icon)

#### Live 404 after «successful» publish

- Same `{branch}--{repo}--{org}` as in the command
- Copy org/repo **exactly** as in da.live (case can matter in URLs)
- Hard refresh / wait a few seconds
- Confirm publish ran (not only `--skip-publish`)

#### Empty subscriptions list / API errors on the page

Not DA — check `subscriptions-storefront-url`, `subscriptions-connection-token`, AccS webhooks, and shopper login (`X-RecurBuy-Customer-Token`).

### Manual DA fallback (no CLI)

1. Create/edit `customer/subscriptions` with block `commerce-subscriptions` (+ account sidebar column like Orders)
2. Add menu item in `customer/sidebar-fragment` → `/customer/subscriptions`
3. Preview + Publish both documents

### Remove Account content (`unpublish-content`)

```bash
npx recurbuy-eds unpublish-content --org=YOUR_ORG --repo=YOUR_REPO --branch=main
# then, if removing the product entirely:
npx recurbuy-eds uninstall --remove-files
```

`unpublish-content`: removes Subscriptions from the sidebar (other items untouched), deletes `customer/subscriptions.html`, unpublishes live/preview for that path, re-publishes the sidebar. Same flags: `--dry-run`, `--login`, `--skip-publish`, `--skip-sidebar`.

---

## Patches & upgrades (stock Adobe files)

Stock touch points: `head.html`, `build.mjs`, `scripts/initializers/cart.js`.

Patches live in **`patches/<theme-version>/`**, matching storefront `package.json` `"version"` (e.g. `11.0.0`).  
`init` / `upgrade` choose that folder from the theme version.

Each manifest entry: `id`, `version`, `file`, `patch`.  
Already applied = every `+` line from the `.patch` is already in the target file.

Commit **`.recurbuy-eds.json`** with the storefront (suite + applied patch versions).

| id | File |
|----|------|
| `cart-loader` | `scripts/initializers/cart.js` |
| `import-map` | `head.html` |
| `build-cart-attrs` | `build.mjs` |

```bash
# Newer RecurBuy, same theme
npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@NEWER
npx recurbuy-eds upgrade
npm run install:dropins

# After theme bump to 12.0.0
npx recurbuy-eds upgrade
npm run install:dropins
```

### When the theme goes 11 → 12

1. Theme `package.json` `"version"` is `12.0.0`.
2. RecurBuy package includes `patches/12.0.0/`.
3. `npx recurbuy-eds upgrade`.

| After the theme upgrade | What `upgrade` does |
|-------------------------|---------------------|
| RecurBuy lines still in stock files | Leaves files alone; sets suite `12.0.0` in `.recurbuy-eds.json` |
| RecurBuy lines wiped | Applies `patches/12.0.0/` |

`patches/11.0.0/` remains for shops still on theme 11. New theme suites are a **full** patch set regenerated against clean stock of that version.

Same theme, new stock change: bump that patch’s `version` and ship a **delta** `.patch` against already-patched stock.

Runtime (no stock `decorate()` rewrites):

| Area | Mechanism |
|------|-----------|
| PDP | auto-mount into `.product-details` + `pdp/*` events |
| Add to cart | `FetchGraphQL` before/after hooks on `CORE_FETCH_GRAPHQL` |
| Cart line markers | after-hook reads `custom_attributes` (cart drop-in drops them while mapping) |
| Cart / mini-cart / checkout | `cart/data` + DOM paint |
| Mini-PDP edit | auto-mount + Update intercept |

### Manual fallback (stock files)

If patches cannot apply:

```js
// scripts/initializers/cart.js
import './recurbuy.js';

// build.mjs
import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';
// … { npm: '@dropins/storefront-cart', operations: [CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION] }
```

Plus the import-map entries below.

---

## Import map

```json
"@dropins/storefront-recurbuy/": "/scripts/__dropins__/storefront-recurbuy/",
"@dropins/storefront-recurbuy": "/scripts/__dropins__/storefront-recurbuy/api.js"
```

---

## Package shape (Adobe-like)

| Path | Role |
|------|------|
| `api.js` | `getShopperAuthToken` |
| `render.js` | `provider.render(Container, props)(el)` |
| `containers/SubscriptionsList.js` | My Subscriptions table |
| `graphql.js` | `CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION` for `build.mjs` |
| `extend/initializer.js` | `installRecurBuyStorefront({ cartClient })` |
| `bin/recurbuy-eds.js` | CLI |
| `templates/` | block, initializer, DA page HTML |
| `patches/<version>/` | stock unified diffs |

```js
import { render as RecurBuy } from '@dropins/storefront-recurbuy/render.js';
import SubscriptionsList from '@dropins/storefront-recurbuy/containers/SubscriptionsList.js';

RecurBuy.render(SubscriptionsList, { getAuthToken, onUnauthenticated, getProfileHref })(root);
```

---

## CLI reference

```bash
npx recurbuy-eds init
npx recurbuy-eds init --dry-run
npx recurbuy-eds upgrade
npx recurbuy-eds upgrade --repatch
npx recurbuy-eds upgrade --refresh-templates
npx recurbuy-eds publish-content --org=… --repo=… [--branch=main] [--dry-run|--login|--skip-publish|--skip-sidebar]
npx recurbuy-eds unpublish-content --org=… --repo=… […]
npx recurbuy-eds doctor [--org=… --repo=…] [--skip-content]
npx recurbuy-eds uninstall
npx recurbuy-eds uninstall --remove-files
npx recurbuy-eds help
```

Auth for publish/unpublish: `DA_TOKEN`, `~/.aem/da-token.json`, or browser via da-auth-helper.

---

## Mental model

| Layer | Owns |
|-------|------|
| Adobe drop-ins | PDP, cart, checkout, GraphQL to AccS |
| Merchant EDS | loader import + `config.json` + DA Account pages |
| **This package** | Plan UI, cart subscription details, My Subscriptions |

Do **not** remap `@dropins/storefront-cart` or fork Adobe drop-in packages.

### Isolation contract

The package is an add-on: it acts only on RecurBuy options and lines.

1. A cart or PDP without RecurBuy data is a strict no-op: no data change, no DOM write, no request.
2. A cart line / option counts as ours only by our quote marker plus its own option id — never by title.
3. Other modules' cart-line attributes are never read or shown.
4. Only `head.html`, `build.mjs` and `scripts/initializers/cart.js` of the stock theme are patched (additive lines).
5. FetchGraphQL / model hooks pass through unless a RecurBuy selection or line is involved.
6. Everything is disposable (`dispose()` restores the host's hooks and removes our DOM).

---

## Checklist

- [ ] Alias `@dropins/storefront-recurbuy` in `package.json`
- [ ] `npx recurbuy-eds init`, then `npm run install:dropins` → `scripts/__dropins__/storefront-recurbuy/`
- [ ] `.recurbuy-eds.json` committed
- [ ] `subscriptions-*` values filled (not empty keys)
- [ ] `publish-content` → live Account page + sidebar link
- [ ] `doctor --org=… --repo=…` green
- [ ] Panel Connection + AccS webhooks + product subscription options
- [ ] Smoke: plan add → subscription price in cart → one-time same SKU stays catalog

---

## Troubleshooting (AccS catalog)

- **Simples show `$0.00` on PLP / blank PDP; configurables OK** — stock EDS auth emits `Magento-Customer-Group` (NLI = SHA1 of `"0"`). On some AccS sandboxes that makes simple prices `roles: hidden` / `final: null` while complex products still price. Confirm with Catalog GraphQL: same SKU without the header has a real `price.final`. Workaround: do not set `Magento-Customer-Group` / `?customer-group=` on the catalog endpoint for that env (or use ACO price books when available). This is catalog auth, not RecurBuy.
- **Bundles never load** — AccS product search with no `BundleProductView` means the sandbox catalog has no bundles. Demo URLs like `/products/…/bundle-1` are empty. Create/sync bundle products in AccS (or point at a catalog that has them).
- **Red `enrichment.json` / `wishlist.json` in Network** — AEM content sheets on the EDS host, not AccS GraphQL. Unrelated to product price.

---

## Development (package authors)

This repository is **only** the package (no storefront theme).

```bash
npm install
npm run lint
npm run test:cli
npm run verify:install                 # fresh boilerplate + install + doctor + uninstall
npm run verify:install -- --ref <tag>  # Adobe git tag for clone; --keep keeps the work dir
npm run verify:patch-upgrade           # id@version upgrade scenarios
```

`verify:install` fails if `init` touches stock files beyond `head.html`, `build.mjs`, `scripts/initializers/cart.js`, and `package.json`, or if `uninstall` does not restore them.
