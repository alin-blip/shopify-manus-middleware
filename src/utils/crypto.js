/**
 * Crypto utilities — HMAC verification for Shopify webhooks and JWT helpers.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verify Shopify webhook HMAC signature.
 * Shopify sends the HMAC in the X-Shopify-Hmac-Sha256 header (base64 encoded).
 * Shopify signs webhooks using the APP SECRET (SHOPIFY_CLIENT_SECRET), NOT a separate webhook secret.
 *
 * We try multiple secrets in priority order to handle misconfiguration gracefully.
 */
function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !rawBody) return false;

  // Build list of candidate secrets to try, in priority order:
  // 1. SHOPIFY_CLIENT_SECRET — the app secret, which is what Shopify actually uses
  // 2. SHOPIFY_WEBHOOK_SECRET — may be set separately (sometimes same as client secret)
  // 3. config values as fallback
  const secrets = [
    process.env.SHOPIFY_CLIENT_SECRET,
    process.env.SHOPIFY_WEBHOOK_SECRET,
    config.shopify.clientSecret,
    config.shopify.webhookSecret,
  ].filter(Boolean);

  // Deduplicate
  const uniqueSecrets = [...new Set(secrets)];

  for (const secret of uniqueSecrets) {
    try {
      const generatedHmac = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

      const generatedBuf = Buffer.from(generatedHmac);
      const headerBuf = Buffer.from(hmacHeader);

      // timingSafeEqual requires same length — if lengths differ, this secret is wrong
      if (generatedBuf.length !== headerBuf.length) continue;

      if (crypto.timingSafeEqual(generatedBuf, headerBuf)) {
        return true;
      }
    } catch (e) {
      // Skip invalid secrets (e.g., empty string, wrong format)
    }
  }

  return false;
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
