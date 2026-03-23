/**
 * Shopify → Manus EduForYou Checkout Redirect Script
 * 
 * Place this script in Shopify Admin → Settings → Checkout → Additional scripts
 * as: <script src="https://shopify-integration-production-2810.up.railway.app/static/checkout-redirect.js"></script>
 * 
 * Behaviour:
 *  - Detects Shopify order status / thank-you page
 *  - Checks for Manus session token in localStorage or URL params
 *  - If found, redirects to EduForYou dashboard after 3 seconds with order context
 *  - If not found, does nothing (user stays on Shopify confirmation page)
 */

(function () {
  'use strict';

  var MANUS_DASHBOARD_URL = 'https://www.eduforyou.co.uk/dashboard';
  var REDIRECT_DELAY_MS   = 3000;
  var TOKEN_KEY           = 'edu_session_token';

  /* ── 1. Only run on the Shopify order-status / thank-you page ── */
  var isOrderStatusPage = (
    window.location.pathname.indexOf('/orders/') !== -1 ||
    window.location.pathname.indexOf('/thank_you') !== -1 ||
    window.location.pathname.indexOf('/checkouts/') !== -1 ||
    (typeof Shopify !== 'undefined' && Shopify.checkout && Shopify.checkout.order_id)
  );

  if (!isOrderStatusPage) return;

  /* ── 2. Retrieve Manus session token ── */
  function getManusToken() {
    // a) localStorage
    try {
      var stored = localStorage.getItem(TOKEN_KEY);
      if (stored) return stored;
    } catch (e) { /* private browsing / blocked */ }

    // b) URL query param  ?manus_token=...
    try {
      var params = new URLSearchParams(window.location.search);
      var urlToken = params.get('manus_token') || params.get('edu_token');
      if (urlToken) return urlToken;
    } catch (e) { /* IE fallback */ }

    // c) Cookie fallback
    try {
      var match = document.cookie.match(/(^|;\s*)edu_session_token=([^;]+)/);
      if (match) return decodeURIComponent(match[2]);
    } catch (e) { /* */ }

    return null;
  }

  /* ── 3. Extract Shopify order ID from the page ── */
  function getOrderId() {
    // Shopify injects a global `Shopify` object on the thank-you page
    if (typeof Shopify !== 'undefined') {
      if (Shopify.checkout && Shopify.checkout.order_id) {
        return String(Shopify.checkout.order_id);
      }
      if (Shopify.order && Shopify.order.id) {
        return String(Shopify.order.id);
      }
    }

    // Fallback: parse from URL  /orders/1234567890/authenticate
    var pathMatch = window.location.pathname.match(/\/orders\/(\d+)/);
    if (pathMatch) return pathMatch[1];

    // Fallback: parse from URL query string  ?order_id=...
    try {
      var params = new URLSearchParams(window.location.search);
      var qid = params.get('order_id');
      if (qid) return qid;
    } catch (e) { /* */ }

    return 'unknown';
  }

  /* ── 4. Build the redirect URL ── */
  function buildRedirectUrl(orderId, token) {
    var url = MANUS_DASHBOARD_URL +
      '?order_confirmed=true' +
      '&order_id=' + encodeURIComponent(orderId) +
      '&source=shopify';

    if (token) {
      url += '&manus_token=' + encodeURIComponent(token);
    }

    return url;
  }

  /* ── 5. Show a friendly countdown banner ── */
  function showBanner(seconds, redirectUrl) {
    var banner = document.createElement('div');
    banner.id = 'manus-redirect-banner';
    banner.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1a1a2e',
      'color:#fff',
      'padding:16px 28px',
      'border-radius:12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:15px',
      'z-index:99999',
      'box-shadow:0 8px 32px rgba(0,0,0,0.3)',
      'display:flex',
      'align-items:center',
      'gap:12px',
      'max-width:90vw',
      'text-align:center'
    ].join(';');

    var logo = document.createElement('span');
    logo.textContent = '🎓';
    logo.style.fontSize = '22px';

    var text = document.createElement('span');
    text.id = 'manus-banner-text';
    text.innerHTML = 'Redirecting you to your <strong>EduForYou Dashboard</strong> in <strong id="manus-countdown">' + seconds + '</strong>s…';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕ Stay here';
    cancelBtn.style.cssText = [
      'background:rgba(255,255,255,0.15)',
      'border:none',
      'color:#fff',
      'padding:6px 14px',
      'border-radius:8px',
      'cursor:pointer',
      'font-size:13px',
      'margin-left:8px',
      'white-space:nowrap'
    ].join(';');

    banner.appendChild(logo);
    banner.appendChild(text);
    banner.appendChild(cancelBtn);
    document.body.appendChild(banner);

    return { banner: banner, cancelBtn: cancelBtn };
  }

  /* ── 6. Main logic ── */
  function init() {
    var token = getManusToken();

    // No Manus session → do nothing
    if (!token) return;

    var orderId     = getOrderId();
    var redirectUrl = buildRedirectUrl(orderId, token);
    var remaining   = Math.ceil(REDIRECT_DELAY_MS / 1000);
    var cancelled   = false;

    var ui = showBanner(remaining, redirectUrl);

    // Cancel button
    ui.cancelBtn.addEventListener('click', function () {
      cancelled = true;
      ui.banner.remove();
    });

    // Countdown ticker
    var ticker = setInterval(function () {
      if (cancelled) { clearInterval(ticker); return; }
      remaining -= 1;
      var el = document.getElementById('manus-countdown');
      if (el) el.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(ticker);
        if (!cancelled) {
          window.location.href = redirectUrl;
        }
      }
    }, 1000);
  }

  /* ── 7. Wait for DOM ready ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
