/**
 * Webhook Routes — handles incoming Shopify webhook events.
 *
 * Supported events:
 *   - orders/create  → Sync new order to Manus student profile
 *   - orders/updated → Update order status in Manus
 *   - customers/create → Ensure customer exists in Manus
 *   - customers/update → Sync customer data changes
 */
const express = require('express');
const router = express.Router();
const shopifyWebhookVerifier = require('../middleware/shopifyWebhook');
const manusApi = require('../services/manusApi');
const shopifyApi = require('../services/shopifyApi');
const logger = require('../utils/logger');

// All webhook routes use HMAC verification
router.use(shopifyWebhookVerifier);

/**
 * POST /webhooks/orders/create
 *
 * Triggered when a new order is placed on Shopify.
 * Extracts order data and syncs it to the student's Manus dashboard.
 */
router.post('/orders/create', async (req, res) => {
  // Respond immediately to Shopify (they expect 200 within 5s)
  res.status(200).json({ received: true });

  try {
    const order = req.body;
    const customerEmail = order.email || order.customer?.email;

    if (!customerEmail) {
      logger.warn('Order received without customer email', { orderId: order.id });
      return;
    }

    logger.info(`Processing new order #${order.order_number}`, {
      email: customerEmail,
      total: order.total_price,
      currency: order.currency,
    });

    // Extract order data for Manus
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
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      orderDate: order.created_at,
      tags: order.tags,
      note: order.note,
      discountCodes: (order.discount_codes || []).map(d => d.code),
    };

    // Sync to Manus
    const result = await manusApi.syncOrderToStudent(orderPayload);

    if (result.success) {
      logger.info(`Order #${order.order_number} synced to Manus`, { email: customerEmail });
    } else {
      logger.error(`Failed to sync order #${order.order_number} to Manus`, {
        email: customerEmail,
        error: result.error,
      });
    }

    // Also ensure the student record exists / is updated
    await manusApi.upsertStudent({
      email: customerEmail.toLowerCase(),
      firstName: order.customer?.first_name,
      lastName: order.customer?.last_name,
      phone: order.customer?.phone,
      source: 'shopify_order',
    });

  } catch (err) {
    logger.error('Error processing orders/create webhook', { error: err.message, stack: err.stack });
  }
});

/**
 * POST /webhooks/orders/updated
 *
 * Triggered when an order is updated (payment confirmed, fulfilled, etc.).
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
