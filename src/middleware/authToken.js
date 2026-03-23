/**
 * Middleware — Integration token verification.
 *
 * Verifies JWT tokens used for cross-platform communication
 * between Shopify Liquid pages and the Manus platform.
 */
const { verifyIntegrationToken } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Verify the integration JWT from Authorization header or query param.
 */
function requireIntegrationToken(req, res, next) {
  let token = null;

  // Check Authorization header
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // Fallback to query parameter
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyIntegrationToken(token);
  if (!decoded) {
    logger.warn('Invalid integration token received');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.integrationUser = decoded;
  next();
}

/**
 * Optional token verification — attaches user if present, continues if not.
 */
function optionalIntegrationToken(req, res, next) {
  let token = null;

  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (token) {
    const decoded = verifyIntegrationToken(token);
    if (decoded) {
      req.integrationUser = decoded;
    }
  }

  next();
}

module.exports = { requireIntegrationToken, optionalIntegrationToken };
