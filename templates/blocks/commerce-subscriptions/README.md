# Commerce Subscriptions

Renders the shopper **My Subscriptions** table (RecurBuy panel profiles) for the logged-in customer.

## Usage

1. Install RecurBuy drop-in (`npx @recurbuy/storefront-eds init`).
2. Place a `commerce-subscriptions` block on `/customer/subscriptions` (or equivalent).
3. Ensure `config.json` has `subscriptions-storefront-url` and `subscriptions-connection-token`.

The block redirects guests to login and mounts `@dropins/storefront-recurbuy` `SubscriptionsList`.
