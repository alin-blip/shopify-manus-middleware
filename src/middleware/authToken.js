/**
 * Middleware — Integration token verification.
 *
 * Verifies JWT tokens used for cross-platform communication
 * between Shopify Liquid pages and the Manus platform.
 *
 * Token sources (checked in order):
 *   1. Authorization: Bearer <token>
 *   2. X-Manus-Token header (sent by Shopify Liquid pages)
 *   3. ?token= query parameter
 */
const { verifyIntegrationToken } = require('../utils/crypto');
const logger = require('../utils/logger');

/**
 * Extract token from request — checks Authorization header,
 * X-Manus-Token header, and query parameter.
 */
function extractToken(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. X-Manus-Token header (sent by Shopify Liquid pages via fetch)
  const manusToken = req.get('X-Manus-Token');
  if (manusToken) {
    return manusToken;
  }

  // 3. Query parameter fallback
  if (req.query.token) {
    return req.query.token;
  }

  return null;
}

/**
 * Verify the integration JWT — required.
 * Returns 401 if token is missing or invalid.
 */
function requireIntegrationToken(req, res, next) {
  const token = extractToken(req);

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
 * Used for quiz routes where unauthenticated submissions are allowed.
 */
function optionalIntegrationToken(req, res, next) {
  const token = extractToken(req);

  if (token) {
    const decoded = verifyIntegrationToken(token);
    if (decoded) {
      req.integrationUser = decoded;
      logger.info('Integration token verified', { userId: decoded.userId || decoded.sub || 'unknown' });
    } else {
      logger.warn('Invalid optional integration token — continuing without auth');
    }
  }

  next();
}

module.exports = { requireIntegrationToken, optionalIntegrationToken };
