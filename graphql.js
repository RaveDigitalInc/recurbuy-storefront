/**
 * GraphQL fragment for merchant `build.mjs` (`overrideGQLOperations`).
 *
 * AccS cart lines need:
 * - `custom_attributes` — RecurBuy subscription markers for the CartModel
 *   transformer (`item.recurbuy`)
 * - `product { uid }` — catalog id for simples (Adobe’s stock product selection
 *   has name/sku/… but no uid; without it SimpleCartItem `catalogProductId`
 *   stays empty and plan-label backfill cannot run)
 *
 * Fields merge into Adobe’s CART_ITEM_FRAGMENT (product.uid is added alongside
 * the stock product fields).
 */

/** Operation string for `@dropins/storefront-cart` CART_ITEM_FRAGMENT extend. */
export const CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION = `
      fragment CART_ITEM_FRAGMENT on CartItemInterface {
        custom_attributes {
          attribute_code
          value
        }
        product {
          uid
        }
      }
      `;
