/**
 * Admin Routes — Order Cleanup
 *
 * Temporary admin endpoints for cleaning up test/incorrect orders in the DB.
 * Protected by MANUS_INTEGRATION_SECRET.
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const config = require('../config');

const MANUS_API_URL = config.manus.apiUrl || process.env.MANUS_API_URL || 'https://www.eduforyou.co.uk';
const INTEGRATION_SECRET = config.manus.integrationSecret || process.env.MANUS_INTEGRATION_SECRET || '';

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Integration-Secret': INTEGRATION_SECRET,
  };
}

function requireAdminSecret(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.headers['x-integration-secret'];
  if (!secret || secret !== INTEGRATION_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * DELETE /admin/order/:orderNumber
 * Deletes a shopify order from the backend DB by order number.
 */
router.delete('/order/:orderNumber', requireAdminSecret, async (req, res) => {
  const { orderNumber } = req.params;
  try {
    logger.info(`[Admin] Deleting order #${orderNumber}`);
    const response = await fetch(`${MANUS_API_URL}/api/shopify/order/${orderNumber}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      logger.error(`[Admin] Delete order failed: ${response.status}`, data);
      return res.status(response.status).json(data);
    }
    logger.info(`[Admin] Order #${orderNumber} deleted successfully`);
    return res.json(data);
  } catch (err) {
    logger.error('[Admin] Delete order error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/orders/:email
 * Lists all orders for a given email from the backend DB.
 */
router.get('/orders/:email', requireAdminSecret, async (req, res) => {
  const { email } = req.params;
  try {
    const response = await fetch(`${MANUS_API_URL}/api/shopify/student/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: buildHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    return res.json({
      email,
      shopifyOrders: data.shopifyOrders || [],
      purchases: data.purchases || [],
    });
  } catch (err) {
    logger.error('[Admin] List orders error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
