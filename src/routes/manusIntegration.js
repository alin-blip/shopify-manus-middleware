/**
 * Manus Integration API Routes
 *
 * These are the tRPC-compatible REST endpoints that need to be added
 * to the EduForYou (Manus) backend to support the integration.
 *
 * This file serves as BOTH:
 *   1. A reference implementation showing the exact API contract
 *   2. A proxy/adapter layer that can be deployed alongside the
 *      integration server if direct tRPC modification is not possible
 *
 * If the Manus backend cannot be modified directly, this adapter
 * stores data in a local SQLite database and exposes it via API
 * that the Manus frontend can consume.
 */
const express = require('express');
const router = express.Router();
const { requireIntegrationToken } = require('../middleware/authToken');
const logger = require('../utils/logger');

// In-memory store (replace with database in production)
// This is a fallback if direct Manus DB access is not available
const store = {
  orders: new Map(),       // email -> [orders]
  quizResults: new Map(),  // email -> { eligibility, ikigai, finance }
  students: new Map(),     // email -> student profile
};

/**
 * POST /manus/sync-order
 *
 * Receives order data from the webhook handler and stores it
 * for the student's dashboard to consume.
 */
router.post('/sync-order', async (req, res) => {
  try {
    const orderData = req.body;
    const email = orderData.email?.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Store order
    if (!store.orders.has(email)) {
      store.orders.set(email, []);
    }

    const orders = store.orders.get(email);
    const existingIdx = orders.findIndex(o => o.shopifyOrderId === orderData.shopifyOrderId);

    if (existingIdx >= 0) {
      // Update existing order
      orders[existingIdx] = { ...orders[existingIdx], ...orderData, updatedAt: new Date().toISOString() };
    } else {
      // Add new order
      orders.push({ ...orderData, syncedAt: new Date().toISOString() });
    }

    logger.info('Order synced to store', { email, orderId: orderData.shopifyOrderId });

    res.json({ success: true, ordersCount: orders.length });

  } catch (err) {
    logger.error('Error syncing order', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /manus/sync-quiz
 *
 * Receives quiz results and stores them for the student's profile.
 */
router.post('/sync-quiz', async (req, res) => {
  try {
    const quizData = req.body;
    const email = quizData.email?.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!store.quizResults.has(email)) {
      store.quizResults.set(email, {});
    }

    const quizzes = store.quizResults.get(email);
    quizzes[quizData.type] = {
      ...quizData,
      syncedAt: new Date().toISOString(),
    };

    logger.info('Quiz results synced', { email, type: quizData.type });

    res.json({ success: true, quizType: quizData.type });

  } catch (err) {
    logger.error('Error syncing quiz', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /manus/upsert-student
 *
 * Creates or updates a student record.
 */
router.post('/upsert-student', async (req, res) => {
  try {
    const studentData = req.body;
    const email = studentData.email?.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const existing = store.students.get(email) || {};
    const updated = {
      ...existing,
      ...studentData,
      email,
      updatedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString(),
    };

    store.students.set(email, updated);

    logger.info('Student upserted', { email, source: studentData.source });

    res.json({ success: true, student: { email: updated.email, name: `${updated.firstName || ''} ${updated.lastName || ''}`.trim() } });

  } catch (err) {
    logger.error('Error upserting student', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /manus/student/:email
 *
 * Retrieves the complete student profile including orders and quiz results.
 * Used by the Manus frontend dashboard to display Shopify data.
 */
router.get('/student/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();

    const student = store.students.get(email) || null;
    const orders = store.orders.get(email) || [];
    const quizResults = store.quizResults.get(email) || {};

    if (!student && orders.length === 0 && Object.keys(quizResults).length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      student,
      orders,
      quizResults,
      shopifyLinked: orders.length > 0,
    });

  } catch (err) {
    logger.error('Error fetching student', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /manus/student/:email/orders
 *
 * Returns only the orders for a specific student.
 * Used by the Manus dashboard "Orders" tab.
 */
router.get('/student/:email/orders', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const orders = store.orders.get(email) || [];

    res.json({ orders, count: orders.length });

  } catch (err) {
    logger.error('Error fetching orders', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /manus/student/:email/quizzes
 *
 * Returns quiz results for a specific student.
 */
router.get('/student/:email/quizzes', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const quizResults = store.quizResults.get(email) || {};

    res.json({ quizResults });

  } catch (err) {
    logger.error('Error fetching quizzes', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
