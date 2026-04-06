/**
 * Middleware — Shopify webhook HMAC verification.
 *
 * Shopify signs every webhook payload with HMAC-SHA256 using the APP SECRET
 * (SHOPIFY_CLIENT_SECRET), NOT a separate webhook secret.
 * This middleware captures the raw body, verifies the signature, and rejects
 * any request that fails verification.
 */
const { verifyShopifyHmac } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Express middleware that verifies Shopify webhook signatures.
 * MUST be used BEFORE any JSON body parser on webhook routes,
 * because we need the raw body for HMAC calculation.
 */
function shopifyWebhookVerifier(req, res, next) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('X-Shopify-Topic');
  const shopDomain = req.get('X-Shopify-Shop-Domain');

  if (!hmac) {
    logger.warn('Webhook received without HMAC header', { topic, shopDomain });
    return res.status(401).json({ error: 'Missing HMAC signature' });
  }

  // rawBody is attached by the raw body parser in server.js
  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.error('Raw body not available for HMAC verification');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  logger.info(`Verifying webhook HMAC for topic: ${topic}`, {
    shopDomain,
    hmacLength: hmac.length,
    rawBodyLength: rawBody.length,
    clientSecretSet: !!process.env.SHOPIFY_CLIENT_SECRET,
    webhookSecretSet: !!process.env.SHOPIFY_WEBHOOK_SECRET,
  });

  if (!verifyShopifyHmac(rawBody, hmac)) {
    logger.warn('Webhook HMAC verification failed — check SHOPIFY_CLIENT_SECRET in Railway env vars', {
      topic,
      shopDomain,
      hmacHeader: hmac.substring(0, 10) + '...',
      clientSecretPrefix: process.env.SHOPIFY_CLIENT_SECRET
        ? process.env.SHOPIFY_CLIENT_SECRET.substring(0, 8) + '...'
        : 'NOT SET',
    });
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  // Attach parsed metadata for downstream handlers
  req.shopifyWebhook = {
    topic,
    shopDomain,
    apiVersion: req.get('X-Shopify-API-Version'),
    webhookId: req.get('X-Shopify-Webhook-Id'),
  };

  logger.info(`Webhook verified: ${topic}`, { shopDomain, webhookId: req.shopifyWebhook.webhookId });
  next();
}

module.exports = shopifyWebhookVerifier;
