/**
 * Crypto utilities — HMAC verification for Shopify webhooks and JWT helpers.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verify Shopify webhook HMAC signature.
 * Shopify sends the HMAC in the X-Shopify-Hmac-Sha256 header.
 */
function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !rawBody) return false;

  const generatedHmac = crypto
    .createHmac('sha256', config.shopify.webhookSecret)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(generatedHmac),
    Buffer.from(hmacHeader)
  );
}

/**
 * Sign a cross-platform integration token.
 * Used to pass authenticated context from Shopify to Manus.
 */
function signIntegrationToken(payload) {
  return jwt.sign(payload, config.integration.jwtSecret, {
    expiresIn: config.integration.tokenExpiry,
    issuer: 'shopify-manus-integration',
    audience: 'eduforyou.co.uk',
  });
}

/**
 * Verify and decode an integration token.
 */
function verifyIntegrationToken(token) {
  try {
    return jwt.verify(token, config.integration.jwtSecret, {
      issuer: 'shopify-manus-integration',
      audience: 'eduforyou.co.uk',
    });
  } catch (err) {
    return null;
  }
}

/**
 * Generate a secure random state parameter for OAuth-like flows.
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  verifyShopifyHmac,
  signIntegrationToken,
  verifyIntegrationToken,
  generateState,
};
