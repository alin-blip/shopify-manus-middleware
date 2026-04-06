/**
 * Configuration — loads from environment variables with sensible defaults.
 */
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  shopify: {
    clientId: process.env.SHOPIFY_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || 'ykiysp-be.myshopify.com',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-01',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET,
  },

  manus: {
    baseUrl: process.env.MANUS_API_URL || process.env.MANUS_BASE_URL || 'https://www.eduforyou.co.uk',
    apiUrl: process.env.MANUS_API_URL || 'https://www.eduforyou.co.uk',
    integrationSecret: process.env.MANUS_INTEGRATION_SECRET || process.env.SHOPIFY_INTEGRATION_SECRET || '',
  },

  integration: {
    jwtSecret: process.env.INTEGRATION_JWT_SECRET || 'change-me-in-production',
    tokenExpiry: '24h',
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://www.eduforyou.co.uk,https://shop.eduforyou.co.uk,https://ykiysp-be.myshopify.com')
    .split(',')
    .map(s => s.trim()),

  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
