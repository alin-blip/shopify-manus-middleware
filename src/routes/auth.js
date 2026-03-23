/**
 * Auth Routes — cross-platform authentication flow.
 *
 * Handles the SSO-like flow between Manus and Shopify:
 *
 * 1. Student logs in to Manus → gets edu_session_token
 * 2. When navigating to Shopify, Manus generates an integration token
 * 3. Shopify Liquid pages read this token to identify the student
 * 4. After checkout, Shopify redirects back to Manus with a signed token
 * 5. Manus validates the token and restores the session
 *
 * Flow A: Manus → Shopify (pre-checkout gate)
 *   GET /auth/shopify-redirect?manusToken=xxx&returnUrl=yyy
 *
 * Flow B: Shopify → Manus (post-checkout redirect)
 *   GET /auth/manus-redirect?email=xxx&orderId=yyy
 *
 * Flow C: Token exchange (Liquid pages calling API)
 *   POST /auth/validate-session { manusToken }
 */
const express = require('express');
const router = express.Router();
const { signIntegrationToken, verifyIntegrationToken, generateState } = require('../utils/crypto');
const manusApi = require('../services/manusApi');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * GET /auth/shopify-redirect
 *
 * Called from Manus when a student clicks "Go to Shop" or similar.
 * Generates an integration token and redirects to Shopify with it.
 *
 * Query params:
 *   - manusToken: the student's edu_session_token from Manus
 *   - returnUrl: the Shopify page to redirect to (default: /collections/all)
 */
router.get('/shopify-redirect', async (req, res) => {
  try {
    const { manusToken, returnUrl } = req.query;

    if (!manusToken) {
      return res.redirect(`${config.manus.baseUrl}/auth/login?returnTo=/student/dashboard`);
    }

    // Verify the Manus session by calling auth.me
    const meResult = await manusApi.trpcQuery('auth.me', undefined, manusToken);

    if (!meResult.success || !meResult.data) {
      logger.warn('Invalid Manus token during Shopify redirect');
      return res.redirect(`${config.manus.baseUrl}/auth/login?returnTo=/student/dashboard`);
    }

    const user = meResult.data;

    // Generate an integration token for Shopify
    const integrationToken = signIntegrationToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      source: 'manus',
    });

    // Build the Shopify redirect URL with the token
    const shopifyUrl = `https://${config.shopify.storeDomain}`;
    const targetPath = returnUrl || '/collections/all';
    const redirectUrl = `${shopifyUrl}${targetPath}?manus_token=${encodeURIComponent(integrationToken)}`;

    logger.info('Redirecting to Shopify with integration token', {
      email: user.email,
      targetPath,
    });

    res.redirect(redirectUrl);

  } catch (err) {
    logger.error('Error in Shopify redirect', { error: err.message });
    res.redirect(`${config.manus.baseUrl}/student/dashboard`);
  }
});

/**
 * GET /auth/manus-redirect
 *
 * Called after Shopify checkout to redirect back to Manus dashboard.
 * Generates a signed token that Manus can verify to restore the session.
 *
 * Query params:
 *   - email: customer email from Shopify
 *   - orderId: Shopify order ID (optional)
 *   - orderNumber: human-readable order number (optional)
 */
router.get('/manus-redirect', async (req, res) => {
  try {
    const { email, orderId, orderNumber } = req.query;

    if (!email) {
      return res.redirect(`${config.manus.baseUrl}/auth/login`);
    }

    // Generate a signed redirect token
    const redirectToken = signIntegrationToken({
      email: email.toLowerCase(),
      orderId,
      orderNumber,
      action: 'post_checkout_redirect',
      source: 'shopify',
    });

    // Redirect to Manus with the token
    const manusRedirectUrl = `${config.manus.baseUrl}/auth/login?shopifyToken=${encodeURIComponent(redirectToken)}&returnTo=/student/dashboard`;

    logger.info('Redirecting to Manus after checkout', { email, orderId });

    res.redirect(manusRedirectUrl);

  } catch (err) {
    logger.error('Error in Manus redirect', { error: err.message });
    res.redirect(`${config.manus.baseUrl}/auth/login`);
  }
});

/**
 * POST /auth/validate-session
 *
 * Called from Shopify Liquid pages (via JavaScript) to validate
 * whether the current visitor has an active Manus session.
 *
 * Body: { manusToken: string }
 * Returns: { valid, email, name, userId } or { valid: false }
 */
router.post('/validate-session', async (req, res) => {
  try {
    const { manusToken } = req.body;

    if (!manusToken) {
      return res.json({ valid: false });
    }

    // Verify against Manus auth.me
    const meResult = await manusApi.trpcQuery('auth.me', undefined, manusToken);

    if (!meResult.success || !meResult.data) {
      return res.json({ valid: false });
    }

    const user = meResult.data;

    // Generate an integration token for this session
    const integrationToken = signIntegrationToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      source: 'manus_validated',
    });

    res.json({
      valid: true,
      email: user.email,
      name: user.name,
      userId: user.id,
      integrationToken,
    });

  } catch (err) {
    logger.error('Error validating session', { error: err.message });
    res.json({ valid: false });
  }
});

/**
 * POST /auth/exchange-token
 *
 * Exchanges a Shopify post-checkout redirect token for user info.
 * Used by the Manus frontend to auto-login after Shopify checkout.
 *
 * Body: { shopifyToken: string }
 * Returns: { valid, email, orderId, orderNumber }
 */
router.post('/exchange-token', async (req, res) => {
  try {
    const { shopifyToken } = req.body;

    if (!shopifyToken) {
      return res.json({ valid: false });
    }

    const decoded = verifyIntegrationToken(shopifyToken);

    if (!decoded || decoded.action !== 'post_checkout_redirect') {
      return res.json({ valid: false });
    }

    res.json({
      valid: true,
      email: decoded.email,
      orderId: decoded.orderId,
      orderNumber: decoded.orderNumber,
    });

  } catch (err) {
    logger.error('Error exchanging token', { error: err.message });
    res.json({ valid: false });
  }
});

/**
 * GET /auth/check-gate
 *
 * Called from Shopify checkout page to verify if the customer
 * has an active Manus session. If not, returns a redirect URL
 * to Manus login.
 *
 * Query: ?manus_token=xxx
 * Returns: { authenticated, redirectUrl? }
 */
router.get('/check-gate', async (req, res) => {
  try {
    const { manus_token } = req.query;

    if (!manus_token) {
      return res.json({
        authenticated: false,
        redirectUrl: `${config.manus.baseUrl}/auth/login?returnTo=/student/dashboard&shopifyCheckout=true`,
      });
    }

    // Verify the integration token
    const decoded = verifyIntegrationToken(manus_token);

    if (!decoded) {
      return res.json({
        authenticated: false,
        redirectUrl: `${config.manus.baseUrl}/auth/login?returnTo=/student/dashboard&shopifyCheckout=true`,
      });
    }

    res.json({
      authenticated: true,
      email: decoded.email,
      name: decoded.name,
    });

  } catch (err) {
    logger.error('Error checking gate', { error: err.message });
    res.json({ authenticated: false });
  }
});

module.exports = router;
