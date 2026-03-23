/**
 * Health Routes — status checks and diagnostics.
 */
const express = require('express');
const router = express.Router();
const config = require('../config');

/**
 * GET /health
 * Basic health check for load balancers and monitoring.
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'shopify-manus-integration',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * GET /health/config
 * Returns non-sensitive configuration for debugging.
 */
router.get('/config', (req, res) => {
  res.json({
    shopifyStore: config.shopify.storeDomain,
    shopifyApiVersion: config.shopify.apiVersion,
    manusBaseUrl: config.manus.baseUrl,
    nodeEnv: config.nodeEnv,
  });
});

module.exports = router;
