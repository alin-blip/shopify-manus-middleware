/**
 * Manus API Service — communicates with the EduForYou REST integration endpoints.
 *
 * All calls go to https://www.eduforyou.co.uk/api/shopify/*
 * and are secured by the X-Integration-Secret header.
 *
 * Available endpoints (added to highticket repo):
 *   POST /api/shopify/order-sync    — Sync Shopify order to student profile
 *   POST /api/shopify/quiz-sync     — Sync quiz results to student profile
 *   GET  /api/shopify/student/:email — Look up student by email
 *   GET  /api/shopify/health        — Health check
 */
const fetch = require('node-fetch');
const config = require('../config');
const logger = require('../utils/logger');

const MANUS_API_URL = process.env.MANUS_API_URL || config.manus.baseUrl || 'https://www.eduforyou.co.uk';
const INTEGRATION_SECRET = process.env.MANUS_INTEGRATION_SECRET || process.env.SHOPIFY_INTEGRATION_SECRET || '';

/**
 * Build common headers for all Manus API calls.
 */
function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Integration-Secret': INTEGRATION_SECRET,
  };
}

/**
 * Look up a student by email via GET /api/shopify/student/:email
 *
 * @param {string} email
 * @returns {{ success: boolean, student?: object, error?: string }}
 */
async function findStudentByEmail(email) {
  const encodedEmail = encodeURIComponent(email.toLowerCase().trim());
  const url = `${MANUS_API_URL}/api/shopify/student/${encodedEmail}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
    });

    const data = await response.json();

    if (response.status === 404) {
      logger.info(`Student not found in Manus: ${email}`);
      return { success: false, found: false, error: 'Student not found' };
    }

    if (!response.ok) {
      logger.error(`Manus student lookup failed: ${response.status}`, { email, data });
      return { success: false, found: false, error: data.error || `HTTP ${response.status}` };
    }

    logger.info(`Student found in Manus: ${email}`, { studentId: data.student?.id });
    return { success: true, found: true, student: data.student, data };

  } catch (err) {
    logger.error('Manus student lookup error', { email, error: err.message });
    return { success: false, found: false, error: err.message };
  }
}

/**
 * Sync a Shopify order to the student's Manus profile.
 * Calls POST /api/shopify/order-sync
 *
 * @param {object} orderData - { email, orderId, orderNumber, products, totalPrice, currency, ... }
 * @returns {{ success: boolean, studentId?: number, error?: string }}
 */
async function syncOrderToStudent(orderData) {
  const url = `${MANUS_API_URL}/api/shopify/order-sync`;

  try {
    logger.info(`Syncing order to Manus: #${orderData.orderNumber || orderData.shopifyOrderId}`, {
      email: orderData.email,
      total: orderData.totalPrice,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        email: orderData.email,
        orderId: orderData.shopifyOrderId || orderData.orderId,
        orderNumber: orderData.orderNumber,
        products: orderData.products || [],
        totalPrice: orderData.totalPrice,
        currency: orderData.currency || 'GBP',
        financialStatus: orderData.financialStatus || 'paid',
        fulfillmentStatus: orderData.fulfillmentStatus || null,
        customerName: orderData.customerName || null,
        createdAt: orderData.orderDate || new Date().toISOString(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error(`Manus order sync failed: ${response.status}`, { data });
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    logger.info(`Order synced to Manus successfully`, {
      email: orderData.email,
      studentId: data.studentId,
      studentFound: data.studentFound,
    });

    return { success: true, studentId: data.studentId, studentFound: data.studentFound, data };

  } catch (err) {
    logger.error('Manus order sync error', { error: err.message, email: orderData.email });
    return { success: false, error: err.message };
  }
}

/**
 * Sync quiz results to the student's Manus profile.
 * Calls POST /api/shopify/quiz-sync
 *
 * IMPORTANT: The backend accepts both `quizType` and `type` field names.
 * We send BOTH for maximum compatibility, plus all top-level fields
 * that the backend can use directly (not just nested in `results`).
 *
 * @param {object} quizData - { type, email, firstName, lastName, phone, results, ... }
 * @returns {{ success: boolean, studentId?: number, error?: string }}
 */
async function syncQuizResults(quizData) {
  const url = `${MANUS_API_URL}/api/shopify/quiz-sync`;

  try {
    const quizType = quizData.quizType || quizData.type;
    logger.info(`Syncing quiz to Manus: ${quizType}`, { email: quizData.email });

    // Build the payload — include both `quizType` and `type` for compatibility,
    // and flatten key fields to top level so the backend can access them directly
    const payload = {
      ...quizData,
      quizType: quizType,        // Backend primary field name
      type: quizType,            // Keep for backwards compat
      // Construct full name from firstName + lastName if not already provided
      name: quizData.name || [quizData.firstName, quizData.lastName].filter(Boolean).join(' ') || undefined,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error(`Manus quiz sync failed: ${response.status}`, { data });
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    logger.info(`Quiz synced to Manus successfully`, {
      email: quizData.email,
      quizType: quizType,
      studentId: data.studentId,
    });

    return { success: true, studentId: data.studentId, studentFound: data.studentFound, data };

  } catch (err) {
    logger.error('Manus quiz sync error', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Create or update a student record from Shopify customer data.
 * Uses findStudentByEmail to check existence, logs the result.
 * (Full upsert requires a Manus account — here we just verify + log)
 *
 * @param {object} studentData - { email, firstName, lastName, phone, ... }
 */
async function upsertStudent(studentData) {
  const email = studentData.email;
  if (!email) return { success: false, error: 'No email provided' };

  // Check if student exists in Manus
  const lookup = await findStudentByEmail(email);

  if (lookup.found) {
    logger.info(`Shopify customer exists in Manus: ${email}`, { studentId: lookup.student?.id });
    return { success: true, found: true, student: lookup.student };
  } else {
    logger.info(`Shopify customer NOT in Manus yet: ${email}`, {
      source: studentData.source,
      name: `${studentData.firstName || ''} ${studentData.lastName || ''}`.trim(),
    });
    return { success: true, found: false, message: 'Student not in Manus — will be linked when they register' };
  }
}

/**
 * Check the Manus integration API health.
 */
async function checkHealth() {
  const url = `${MANUS_API_URL}/api/shopify/health`;
  try {
    const response = await fetch(url, { method: 'GET', headers: buildHeaders() });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  findStudentByEmail,
  syncOrderToStudent,
  syncQuizResults,
  upsertStudent,
  checkHealth,
};
