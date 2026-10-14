/**
 * GraphQL fragment for merchant `build.mjs` (`overrideGQLOperations`).
 *
 * AccS cart lines need `custom_attributes` so RecurBuy subscription markers
 * reach the cart drop-in transformer.
 */

/** Operation string for `@dropins/storefront-cart` CART_ITEM_FRAGMENT extend. */
export const CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION = `
      fragment CART_ITEM_FRAGMENT on CartItemInterface {
        custom_attributes {
          attribute_code
          value
        }
      }
      `;
