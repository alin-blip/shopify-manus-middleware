/**
 * Shopify ↔ Manus Integration Server
 *
 * Main entry point. Sets up Express with:
 *   - Raw body capture for Shopify HMAC verification
 *   - CORS for cross-origin requests from Shopify/Manus
 *   - Webhook routes (Shopify → Manus)
 *   - Quiz sync routes (Shopify Liquid → Manus)
 *   - Auth routes (cross-platform SSO)
 *   - Manus integration API (data store/adapter)
 *   - Health check endpoints
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

// Route modules
const webhookRoutes = require('./routes/webhooks');
const quizRoutes = require('./routes/quiz');
const authRoutes = require('./routes/auth');
const manusRoutes = require('./routes/manusIntegration');
const healthRoutes = require('./routes/health');

const app = express();

// ── Security Headers ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));

// ── CORS ──
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (webhooks, server-to-server)
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development, allow all origins
    if (config.nodeEnv === 'development') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Shopify-Hmac-Sha256', 'X-Shopify-Topic', 'X-Shopify-Shop-Domain'],
}));

// ── Body Parsing ──
// For webhook routes: capture raw body for HMAC verification
app.use('/webhooks', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// For all other routes: standard JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request Logging ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/health')) {
      logger.info(`${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    }
  });
  next();
});

// ── Static Files ──
// Serves /public directory at /static — used for checkout-redirect.js
app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));

// ── Routes ──
app.use('/webhooks', webhookRoutes);
app.use('/quiz', quizRoutes);
app.use('/auth', authRoutes);
app.use('/manus', manusRoutes);
app.use('/health', healthRoutes);

// ── Root ──
app.get('/', (req, res) => {
  res.json({
    service: 'Shopify ↔ Manus EduForYou Integration',
    version: '1.0.0',
    endpoints: {
      webhooks: '/webhooks/orders/create, /webhooks/orders/updated, /webhooks/customers/create, /webhooks/customers/update',
      quiz: '/quiz/eligibility, /quiz/ikigai, /quiz/finance',
      auth: '/auth/shopify-redirect, /auth/manus-redirect, /auth/validate-session, /auth/exchange-token, /auth/check-gate',
      manus: '/manus/sync-order, /manus/sync-quiz, /manus/upsert-student, /manus/student/:email',
      health: '/health, /health/config',
    },
  });
});

// ── 404 Handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Error Handler ──
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start Server ──
const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Integration server running on port ${PORT}`, {
    env: config.nodeEnv,
    shopify: config.shopify.storeDomain,
    manus: config.manus.baseUrl,
  });
});

module.exports = app;
