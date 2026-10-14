import { installRecurBuyStorefront } from '@dropins/storefront-recurbuy/extend/initializer.js';
import { CORE_FETCH_GRAPHQL } from '../commerce.js';

/**
 * RecurBuy runtime install.
 * Loaded from scripts/initializers/cart.js, so it runs wherever the cart does.
 * Config keys are read from /config.json by the package itself.
 */
installRecurBuyStorefront({ cartClient: CORE_FETCH_GRAPHQL });
