/**
 * Webhook Routes — handles incoming Shopify webhook events.
 *
 * Supported events:
 *   - orders/create  → Fetches full order details from Shopify API if line_items are empty,
 *                      then syncs to Manus regardless of payment status.
 *   - orders/paid    → Primary trigger: syncs complete paid order to Manus student profile
 *   - orders/updated → Updates order status in Manus
 *   - customers/create → Ensures customer exists in Manus
 *   - customers/update → Syncs customer data changes
 */
const express = require('express');
const router = express.Router();
const https = require('https');
const shopifyWebhookVerifier = require('../middleware/shopifyWebhook');
const manusApi = require('../services/manusApi');
const logger = require('../utils/logger');
const config = require('../config');

// All webhook routes use HMAC verification
router.use(shopifyWebhookVerifier);

/**
 * Fetch full order details from Shopify REST API.
 * Used when orders/create arrives with empty line_items.
 */
async function fetchOrderFromShopify(orderId) {
  const storeDomain = config.shopify.storeDomain;
  const apiVersion = config.shopify.apiVersion;
  const accessToken = config.shopify.accessToken;

  if (!accessToken) {
    logger.warn('[shopify-api] SHOPIFY_ACCESS_TOKEN not set — cannot fetch order details');
    return null;
  }

  const url = `https://${storeDomain}/admin/api/${apiVersion}/orders/${orderId}.json`;

  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.order) {
            logger.info(`[shopify-api] Fetched order #${parsed.order.order_number} from Shopify API`, {
              lineItemCount: (parsed.order.line_items || []).length,
              totalPrice: parsed.order.total_price,
            });
            resolve(parsed.order);
          } else {
            logger.warn('[shopify-api] No order in response', { data: data.substring(0, 200) });
            resolve(null);
          }
        } catch (e) {
          logger.error('[shopify-api] Failed to parse response', { error: e.message });
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      logger.error('[shopify-api] Request failed', { error: e.message });
      resolve(null);
    });

    req.end();
  });
}

/**
 * Shared helper: extract and sync an order to Manus.
 * Used by both orders/create and orders/paid.
 */
async function syncPaidOrder(order, source) {
  const customerEmail = order.email || order.customer?.email;
  if (!customerEmail) {
    logger.warn(`[${source}] Order received without customer email`, { orderId: order.id });
    return;
  }

  logger.info(`[${source}] Syncing order #${order.order_number}`, {
    email: customerEmail,
    total: order.total_price,
    currency: order.currency,
    financialStatus: order.financial_status,
    lineItemCount: (order.line_items || []).length,
  });

  const orderPayload = {
    source: 'shopify',
    shopifyOrderId: String(order.id),
    orderNumber: order.order_number,
    email: customerEmail.toLowerCase(),
    customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
    products: (order.line_items || []).map(item => ({
      title: item.title,
      variant: item.variant_title,
      sku: item.sku,
      quantity: item.quantity,
      price: item.price,
      productId: String(item.product_id),
    })),
    totalPrice: order.total_price,
    subtotalPrice: order.subtotal_price,
    currency: order.currency,
    financialStatus: order.financial_status || 'pending',
    fulfillmentStatus: order.fulfillment_status,
    orderDate: order.created_at,
    tags: order.tags,
    note: order.note,
    discountCodes: (order.discount_codes || []).map(d => d.code),
  };

  const result = await manusApi.syncOrderToStudent(orderPayload);

  if (result.success) {
    logger.info(`[${source}] Order #${order.order_number} synced to Manus`, { email: customerEmail });
  } else {
    logger.error(`[${source}] Failed to sync order #${order.order_number} to Manus`, {
      email: customerEmail,
      error: result.error,
    });
  }

  // Ensure the student record exists / is updated
  await manusApi.upsertStudent({
    email: customerEmail.toLowerCase(),
    firstName: order.customer?.first_name,
    lastName: order.customer?.last_name,
    phone: order.customer?.phone,
    source: 'shopify_order',
  });
}

/**
 * POST /webhooks/orders/create
 *
 * Triggered when a new order is placed on Shopify.
 * If line_items are empty (common for pending orders), fetches full order
 * details from Shopify REST API before syncing.
 * Syncs all orders regardless of payment status.
 */
router.post('/orders/create', async (req, res) => {
  // Respond immediately to Shopify (they expect 200 within 5s)
  res.status(200).json({ received: true });

  try {
    let order = req.body;
    const lineItems = order.line_items || [];
    const hasProducts = lineItems.length > 0 && lineItems[0].title;
    const totalPrice = parseFloat(order.total_price || '0');

    // If line_items are empty or total_price is 0, fetch full order from Shopify API
    if (!hasProducts || totalPrice === 0) {
      logger.info(`[orders/create] Order #${order.order_number} has incomplete data — fetching from Shopify API`, {
        lineItemCount: lineItems.length,
        totalPrice: order.total_price,
        financialStatus: order.financial_status,
      });

      const fullOrder = await fetchOrderFromShopify(order.id);
      if (fullOrder) {
        order = fullOrder;
        logger.info(`[orders/create] Got full order from Shopify API`, {
          lineItemCount: (order.line_items || []).length,
          totalPrice: order.total_price,
        });
      } else {
        logger.warn(`[orders/create] Could not fetch full order — syncing with available data`, {
          orderId: order.id,
        });
      }
    }

    await syncPaidOrder(order, 'orders/create');

  } catch (err) {
    logger.error('Error processing orders/create webhook', { error: err.message, stack: err.stack });
  }
});

/**
 * POST /webhooks/orders/paid
 *
 * Triggered when payment is confirmed for an order.
 * This is the PRIMARY event for syncing complete paid order data to Manus.
 * At this point, line_items and all order details are guaranteed to be complete.
 */
router.post('/orders/paid', async (req, res) => {
  // Respond immediately to Shopify (they expect 200 within 5s)
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    await syncPaidOrder(order, 'orders/paid');
  } catch (err) {
    logger.error('Error processing orders/paid webhook', { error: err.message, stack: err.stack });
  }
});

/**
 * POST /webhooks/orders/updated
 *
 * Triggered when an order is updated (payment confirmed, fulfilled, etc.).
 * Also handles the case where financial_status transitions to 'paid'.
 */
router.post('/orders/updated', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    const customerEmail = order.email || order.customer?.email;

    if (!customerEmail) return;

    logger.info(`Processing order update #${order.order_number}`, {
      email: customerEmail,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
    });

    // If the order just became paid and has line_items, do a full sync
    if (order.financial_status === 'paid' && order.line_items && order.line_items.length > 0) {
      logger.info(`[orders/updated] Order #${order.order_number} is now paid — doing full sync`);
      await syncPaidOrder(order, 'orders/updated');
      return;
    }

    // Otherwise just update the status fields
    const updatePayload = {
      source: 'shopify',
      shopifyOrderId: String(order.id),
      orderNumber: order.order_number,
      email: customerEmail.toLowerCase(),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      updatedAt: order.updated_at,
      cancelledAt: order.cancelled_at,
      cancelReason: order.cancel_reason,
    };

    await manusApi.syncOrderToStudent(updatePayload);

  } catch (err) {
    logger.error('Error processing orders/updated webhook', { error: err.message });
  }
});

/**
 * POST /webhooks/customers/create
 *
 * Triggered when a new customer is created in Shopify.
 * Ensures the student exists in Manus (upsert by email).
 */
router.post('/customers/create', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const customer = req.body;
    const email = customer.email;

    if (!email) {
      logger.warn('Customer created without email', { customerId: customer.id });
      return;
    }

    logger.info('New Shopify customer', { email, customerId: customer.id });

    await manusApi.upsertStudent({
      email: email.toLowerCase(),
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      shopifyCustomerId: String(customer.id),
      source: 'shopify_customer',
      tags: customer.tags,
    });

  } catch (err) {
    logger.error('Error processing customers/create webhook', { error: err.message });
  }
});

/**
 * POST /webhooks/customers/update
 *
 * Triggered when a customer is updated in Shopify.
 */
router.post('/customers/update', async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const customer = req.body;
    if (!customer.email) return;

    await manusApi.upsertStudent({
      email: customer.email.toLowerCase(),
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      shopifyCustomerId: String(customer.id),
      source: 'shopify_customer_update',
    });

  } catch (err) {
    logger.error('Error processing customers/update webhook', { error: err.message });
  }
});

module.exports = router;
