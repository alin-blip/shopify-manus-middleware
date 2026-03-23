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
    version: '1.1.0',
    manusApiUrl: config.manus.apiUrl,
    shopifyStore: config.shopify.storeDomain,
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
    manusApiUrl: config.manus.apiUrl,
    integrationSecretConfigured: !!config.manus.integrationSecret,
    nodeEnv: config.nodeEnv,
  });
});

/**
 * GET /health/manus
 * Checks connectivity to the EduForYou Manus API.
 */
router.get('/manus', async (req, res) => {
  try {
    const manusApi = require('../services/manusApi');
    const result = await manusApi.checkHealth();
    if (result.ok) {
      res.json({ status: 'ok', manus: result.data });
    } else {
      res.status(503).json({ status: 'error', error: result.error || `HTTP ${result.status}` });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
