/**
 * Finance Calculator Fix — patches FC.saveWithEmail to call EduForYou API directly
 * Bypasses the broken middleware (shopify-integration-production-2810.up.railway.app)
 *
 * Injected via Shopify Script Tag on /pages/finance-calculator
 *
 * v2: uses polling (setInterval) to handle cases where window.FC is defined late
 * (window.FC is defined inline in the section liquid, which loads AFTER this script)
 */
(function() {
  var MANUS_API_URL = 'https://www.eduforyou.co.uk';
  var INTEGRATION_SECRET = 'shopify_manus_secret_2026_eduforyou';

  function mapLivingLocation(loc) {
    var map = { outsideLondon: 'outside_london', london: 'london', withParents: 'with_parents' };
    return map[loc] || loc;
  }

  function syncFinanceDirect(email) {
    var living   = (document.getElementById('efy-living') || {}).value || 'outsideLondon';
    var duration = parseInt((document.getElementById('efy-duration') || {}).value || '3');
    var salary   = parseInt((document.getElementById('efy-salary') || {}).value || '30000');

    var TUITION = 9535;
    var MAINTENANCE = { london: 13022, outsideLondon: 10227, withParents: 8610 };
    var maintenance = MAINTENANCE[living] || 10227;
    var totalPerYear = TUITION + maintenance;
    var totalCourse = totalPerYear * duration;
    var monthly = salary <= 25000 ? 0 : Math.round(((salary - 25000) * 0.09) / 12);

    var payload = {
      quizType: 'finance',
      email: email,
      tuitionFee: String(TUITION),
      maintenanceLoan: String(maintenance),
      totalEstimate: String(totalCourse),
      livingLocation: mapLivingLocation(living),
      householdIncome: '0',
      inputs: {
        courseDuration: duration,
        expectedSalary: salary,
        livingLocation: living,
        monthlyRepayment: monthly
      }
    };

    return fetch(MANUS_API_URL + '/api/shopify/quiz-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-secret': INTEGRATION_SECRET
      },
      body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); });
  }

  function patchFC() {
    // Show the email save section (always visible)
    var emailSave = document.getElementById('fc-save-email');
    if (emailSave) emailSave.style.display = '';

    // Hide the auth save section (requires middleware session)
    var authSave = document.getElementById('fc-save-auth');
    if (authSave) authSave.style.display = 'none';

    // Patch FC.saveWithEmail to use direct API
    if (window.FC) {
      window.FC.saveWithEmail = function() {
        var email = (document.getElementById('fc-email') || {}).value;
        if (!email) email = '';
        email = email.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          var s = document.getElementById('fc-save-email-status');
          if (s) { s.textContent = 'Please enter a valid email'; s.style.color = '#ef4444'; }
          return;
        }

        var statusEl = document.getElementById('fc-save-email-status');
        if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = '#666'; }

        syncFinanceDirect(email)
          .then(function(result) {
            if (statusEl) {
              statusEl.textContent = result.success
                ? '\u2713 Saved! Check your dashboard at eduforyou.co.uk'
                : 'Failed to save. Please try again.';
              statusEl.style.color = result.success ? '#10b981' : '#ef4444';
            }
          })
          .catch(function() {
            if (statusEl) { statusEl.textContent = 'Failed to save. Please try again.'; statusEl.style.color = '#ef4444'; }
          });
      };
      return true; // patched successfully
    }
    return false; // FC not ready yet
  }

  // Poll until window.FC is defined (handles late-loading inline scripts)
  // window.FC is defined in the section liquid which loads AFTER this script tag
  var attempts = 0;
  var maxAttempts = 50; // 5 seconds max (50 x 100ms)
  var interval = setInterval(function() {
    attempts++;
    if (patchFC()) {
      clearInterval(interval);
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      // FC never loaded — show email form anyway
      var emailSave = document.getElementById('fc-save-email');
      if (emailSave) emailSave.style.display = '';
    }
  }, 100);
})();
