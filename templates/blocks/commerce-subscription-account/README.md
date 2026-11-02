# Commerce Subscription Account

Scaffold block for Magento SARP shopper pages under `aw_sarp2/profile_edit*`:

| Path | Magento |
|------|---------|
| `/customer/subscriptions/detail` | `profile_edit/index` |
| `/customer/subscriptions/edit-plan` | `profile_edit/plan` |
| `/customer/subscriptions/edit-address` | `profile_edit/address` |
| `/customer/subscriptions/edit-payment` | `profile_edit/payment` |
| `/customer/subscriptions#rb/edit-next-payment-date/{profile}` | `profile_edit/nextPaymentDate` (wired: POST next-payment-date) |
| `/customer/subscriptions#rb/edit-item/{profile}/{item}` | `profile_edit/item` (wired: configure + PUT items) |

Place a `commerce-subscription-account` block on each DA page (see `templates/content/subscriptions/*.html`). The drop-in resolves the page from the URL and reads `profile_id` / `item_id` query params.
