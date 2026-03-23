/**
 * Shopify Admin API Service — communicates with Shopify's REST Admin API.
 *
 * Uses the custom app credentials to access orders and customers.
 * Requires an access token obtained through the OAuth flow or custom app install.
 */
const fetch = require('node-fetch');
const config = require('../config');
const logger = require('../utils/logger');

const SHOPIFY_BASE = `https://${config.shopify.storeDomain}/admin/api/${config.shopify.apiVersion}`;

/**
 * Make an authenticated request to the Shopify Admin API.
 * For custom apps, the access token is the API secret key or
 * the Admin API access token from the app settings.
 */
async function shopifyRequest(endpoint, method = 'GET', body = null, accessToken = null) {
  const token = accessToken || process.env.SHOPIFY_ACCESS_TOKEN || config.shopify.clientSecret;
  const url = `${SHOPIFY_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };

  const options = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Shopify API error: ${method} ${endpoint}`, {
        status: response.status,
        body: errorText,
      });
      return { success: false, status: response.status, error: errorText };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    logger.error(`Shopify API request failed: ${endpoint}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Search for a Shopify customer by email.
 */
async function findCustomerByEmail(email) {
  return shopifyRequest(`/customers/search.json?query=email:${encodeURIComponent(email)}`);
}

/**
 * Get a specific order by ID.
 */
async function getOrder(orderId) {
  return shopifyRequest(`/orders/${orderId}.json`);
}

/**
 * Get customer by ID.
 */
async function getCustomer(customerId) {
  return shopifyRequest(`/customers/${customerId}.json`);
}

/**
 * Tag a customer with metadata (using customer metafields or tags).
 */
async function tagCustomer(customerId, tags) {
  return shopifyRequest(`/customers/${customerId}.json`, 'PUT', {
    customer: { id: customerId, tags },
  });
}

/**
 * Add a note to a customer.
 */
async function addCustomerNote(customerId, note) {
  return shopifyRequest(`/customers/${customerId}.json`, 'PUT', {
    customer: { id: customerId, note },
  });
}

module.exports = {
  shopifyRequest,
  findCustomerByEmail,
  getOrder,
  getCustomer,
  tagCustomer,
  addCustomerNote,
};
