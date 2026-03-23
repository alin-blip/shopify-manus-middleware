/**
 * Manus API Service — communicates with the EduForYou tRPC backend.
 *
 * The EduForYou platform uses tRPC at /api/trpc with JWT Bearer auth.
 * This service provides methods to:
 *   1. Look up students by email
 *   2. Sync order data to student profiles
 *   3. Sync quiz results to student profiles
 *   4. Create/update student records
 */
const fetch = require('node-fetch');
const config = require('../config');
const logger = require('../utils/logger');

const TRPC_URL = config.manus.apiUrl;

/**
 * Generic tRPC query call.
 */
async function trpcQuery(procedure, input, authToken) {
  const url = `${TRPC_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, { method: 'GET', headers });
    const data = await response.json();

    if (data.error) {
      logger.error(`tRPC query error: ${procedure}`, { error: data.error });
      return { success: false, error: data.error };
    }

    return { success: true, data: data.result?.data?.json };
  } catch (err) {
    logger.error(`tRPC query failed: ${procedure}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Generic tRPC mutation call.
 */
async function trpcMutation(procedure, input, authToken) {
  const url = `${TRPC_URL}/${procedure}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ json: input }),
    });
    const data = await response.json();

    if (data.error) {
      logger.error(`tRPC mutation error: ${procedure}`, { error: data.error });
      return { success: false, error: data.error };
    }

    return { success: true, data: data.result?.data?.json };
  } catch (err) {
    logger.error(`tRPC mutation failed: ${procedure}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Look up a student by email via the integration API.
 * This calls a custom endpoint that needs to be added to the Manus backend.
 */
async function findStudentByEmail(email) {
  return trpcQuery('integration.findByEmail', { email });
}

/**
 * Sync a Shopify order to the student's Manus profile.
 */
async function syncOrderToStudent(orderData) {
  return trpcMutation('integration.syncOrder', orderData);
}

/**
 * Sync quiz results to the student's Manus profile.
 */
async function syncQuizResults(quizData) {
  return trpcMutation('integration.syncQuiz', quizData);
}

/**
 * Create or update a student record from Shopify customer data.
 */
async function upsertStudent(studentData) {
  return trpcMutation('integration.upsertStudent', studentData);
}

/**
 * Generate a Manus session token for a verified student.
 * This allows seamless redirect from Shopify to the Manus dashboard.
 */
async function generateManusSession(email) {
  return trpcMutation('integration.createSession', { email });
}

module.exports = {
  trpcQuery,
  trpcMutation,
  findStudentByEmail,
  syncOrderToStudent,
  syncQuizResults,
  upsertStudent,
  generateManusSession,
};
