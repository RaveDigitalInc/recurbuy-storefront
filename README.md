# `@recurbuy/storefront-eds`

RecurBuy **subscription drop-in** for Adobe Commerce Storefront (EDS).

Install so stock Adobe `install:dropins` vendors the package — **do not fork `postinstall.js`**.

**Requires** [aem-boilerplate-commerce](https://github.com/hlxsites/aem-boilerplate-commerce) v11+ (cart drop-in 3.x): RecurBuy hooks into the `CORE_FETCH_GRAPHQL` instance exported by `scripts/commerce.js`. Older bases (v3, cart 1.x) do not expose it and are not supported.

Full delivery plan: SaaS repo `docs/recurbuy/eds-package-delivery.md`.

---

## Install (recommended)

### 1. Alias dependency

In the merchant storefront `package.json`:

```json
"@dropins/storefront-recurbuy": "npm:@recurbuy/storefront-eds@0.2.0"
```

Local tarball (before the package is published):

```bash
npm pack                         # in this repository
npm install "@dropins/storefront-recurbuy@file:/path/to/recurbuy-storefront-eds-0.2.0.tgz"
```

Published package name stays `@recurbuy/storefront-eds`. The `@dropins/…` name is an **alias in the merchant project only**.

### 2. One command install (no hand-editing Adobe blocks)

```bash
npm install @dropins/storefront-recurbuy@npm:@recurbuy/storefront-eds@0.2.0
npx recurbuy-eds init
npm run install:dropins          # vendors the drop-in + applies the build.mjs fragment
# fill subscriptions-* keys in config.json
npx recurbuy-eds doctor
```

`init` leaves stock `decorate()` bodies alone. It:

- adds import map entries to `head.html`
- adds the `custom_attributes` cart fragment to `build.mjs` (2 lines)
- adds **one** load line: `import './recurbuy.js'` in `scripts/initializers/cart.js`
- copies `scripts/initializers/recurbuy.js` + the `commerce-subscriptions` block
- creates subscriptions page stub + empty `subscriptions-*` keys in `config.json`

At runtime RecurBuy uses Adobe extension points only:

| Area | Mechanism |
|------|-----------|
| PDP | auto-mount into `.product-details` + `pdp/*` events |
| Add to cart | `FetchGraphQL` before/after hooks on `CORE_FETCH_GRAPHQL` |
| Cart line markers | same after-hook reads `custom_attributes` of every cart response (the cart drop-in drops them while mapping) |
| Cart / mini-cart / checkout | `cart/data` + DOM paint, repainted when rows appear (no slots required) |
| Mini-PDP edit | auto-mount + Update intercept |

**Update:** bump the npm alias version → `npm install` → `npm run install:dropins` (re-run `init` only if the report asks for it; it is idempotent). Runtime code lives in the vendored package, so merchants do not re-patch blocks.

**Uninstall:** `npx recurbuy-eds uninstall [--remove-files]` (removes the cart loader import, import map entries and the `build.mjs` fragment).

### 3. Config values (not code)

`config.json` belongs to the merchant's storefront (the boilerplate ships `demo-config.json` as a sample; copy it to `config.json` first). The package never touches the Commerce endpoints in it and only adds **two** keys to `public.default`. `init` creates them empty and prints which ones still need a value:

| Key | Value |
|-----|-------|
| `subscriptions-storefront-url` | URL of your RecurBuy panel |
| `subscriptions-connection-token` | storefront token of this store's Connection in the panel |

The panel resolves the store view and website from the token, so nothing else is configured here. `config.json` is served publicly by Edge Delivery, so use only the storefront token meant for browsers, never a merchant API token.

Panel side: Connection + AccS webhooks + subscription options on products.

### 4. Authoring

Publish the subscriptions page (`content/customer/subscriptions.html` or UE) and a sidebar link. Content change, not code.

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
| `bin/recurbuy-eds.js` | `init` / `doctor` / `uninstall` |

```js
import { render as RecurBuy } from '@dropins/storefront-recurbuy/render.js';
import SubscriptionsList from '@dropins/storefront-recurbuy/containers/SubscriptionsList.js';

RecurBuy.render(SubscriptionsList, { getAuthToken, onUnauthenticated, getProfileHref })(root);
```

---

## No decorate() text patches

Stock Adobe blocks are not rewritten by the CLI. Injection is normal JS inside the
package (`src/extend/*`): hooks, event listeners, MutationObserver mounts.

If `init` cannot patch the cart initializer / `build.mjs` / import map (fork diverged), add manually:

```js
// scripts/initializers/cart.js
import './recurbuy.js';

// build.mjs
import { CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION } from '@dropins/storefront-recurbuy/graphql.js';
// … { npm: '@dropins/storefront-cart', operations: [CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION] }
```

---

## CLI

```bash
npx recurbuy-eds init
npx recurbuy-eds init --dry-run
npx recurbuy-eds doctor
npx recurbuy-eds uninstall
npx recurbuy-eds uninstall --remove-files
```

---

## Development

This repository contains only the package (no storefront theme).

```bash
npm install
npm run lint
npm run verify:install                 # fresh boilerplate clone + install per this README + doctor + uninstall
npm run verify:install -- --ref <tag>  # other boilerplate ref; --keep keeps the work dir for manual checks
```

`verify:install` is the release gate: it fails if `init` touches any stock file beyond `head.html`, `build.mjs`, `scripts/initializers/cart.js` and `package.json`, or if `uninstall` does not restore them. To try it in a browser, run it with `--keep`, add real `subscriptions-*` values to `config.json` in the kept folder and start `aem up` there.

---

## Mental model

| Layer | Owns |
|-------|------|
| Adobe drop-ins | PDP, cart, checkout, GraphQL to AccS |
| Merchant EDS | one loader import + `config.json` (+ subscriptions page) |
| **This package** | Plan UI, AccS pending-add, cart line paint, My Subscriptions |

Do **not** remap `@dropins/storefront-cart` or fork Adobe drop-in packages.

---

## Checklist

- [ ] Alias `@dropins/storefront-recurbuy` in `package.json`
- [ ] `npx recurbuy-eds init`, then `npm run install:dropins` → `scripts/__dropins__/storefront-recurbuy/`
- [ ] `npx recurbuy-eds doctor`
- [ ] Config values filled (not just empty keys)
- [ ] Account page + sidebar for subscriptions
- [ ] Panel Connection + AccS webhooks + product subscription options
- [ ] Smoke: plan add → subscription price in cart → one-time same SKU stays catalog

---

## Troubleshooting (AccS catalog)

- **Simples show `$0.00` on PLP / blank PDP; configurables OK** — stock EDS auth emits `Magento-Customer-Group` (NLI = SHA1 of `"0"`). On some AccS sandboxes that makes simple prices `roles: hidden` / `final: null` while complex products still price. Confirm with Catalog GraphQL: same SKU without the header has a real `price.final`. Workaround: do not set `Magento-Customer-Group` / `?customer-group=` on the catalog endpoint for that env (or use ACO price books when available). This is catalog auth, not RecurBuy.
- **Bundles never load** — AccS product search with no `BundleProductView` means the sandbox catalog has no bundles. Demo URLs like `/products/…/bundle-1` are empty. Create/sync bundle products in AccS (or point at a catalog that has them).
- **Red `enrichment.json` / `wishlist.json` in Network** — AEM content sheets on the EDS host, not AccS GraphQL. Unrelated to product price.

---

## Related (SaaS panel repo)

- Delivery plan: `docs/recurbuy/eds-package-delivery.md`
- AccS add-to-cart: `docs/recurbuy/storefront-accs-drop-in-addtocart.md`
- Storefront HTTP API: `docs/recurbuy/storefront-api.md`
