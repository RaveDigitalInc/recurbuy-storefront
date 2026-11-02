# Commerce Subscriptions

Renders shopper **My Subscriptions** and detail/edit scaffolds on **one** Account page.

## Usage

1. Install RecurBuy drop-in (`npx recurbuy-eds init`).
2. Place a `commerce-subscriptions` block on `/customer/subscriptions`.
3. Ensure `config.json` has `subscriptions-storefront-url` and `subscriptions-connection-token`.

Guests redirect to login. With no `#rb/…` hash, mounts `SubscriptionsList`. With
`#rb/detail/91` (or `#rb/edit-plan/91`, `#rb/edit-item/91/3`, …), mounts the matching page on the same DA document.
