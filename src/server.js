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
const adminRoutes = require('./routes/admin');

const app = express();

// ── Security Headers ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));

// ── CORS ──
// Always allow shop.eduforyou.co.uk and related origins regardless of env vars
const ALWAYS_ALLOWED = [
  'https://shop.eduforyou.co.uk',
  'https://www.eduforyou.co.uk',
  'https://eduforyou.co.uk',
  'https://ykiysp-be.myshopify.com',
];
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (webhooks, server-to-server)
    if (!origin) return callback(null, true);
    // Always allow core EduForYou origins
    if (ALWAYS_ALLOWED.includes(origin)) {
      return callback(null, true);
    }
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development, allow all origins
    if (config.nodeEnv === 'development') {
      return callback(null, true);
    }
    logger.warn('CORS blocked origin', { origin });
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Manus-Token', 'X-Shopify-Hmac-Sha256', 'X-Shopify-Topic', 'X-Shopify-Shop-Domain'],
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

// ── Dynamic JS Endpoints ──
// Serves finance-calc-fix v2 inline (polling-based patch for Finance Calculator)
app.get('/js/finance-fix.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const code = `(function(){
  var A='https://www.eduforyou.co.uk',B='shopify_manus_secret_2026_eduforyou';
  function mL(l){return({outsideLondon:'outside_london',london:'london',withParents:'with_parents'})[l]||l;}
  function sync(email){
    var lv=(document.getElementById('efy-living')||{}).value||'outsideLondon';
    var dur=parseInt((document.getElementById('efy-duration')||{}).value||'3');
    var sal=parseInt((document.getElementById('efy-salary')||{}).value||'30000');
    var T=9535,M={london:13022,outsideLondon:10227,withParents:8610},m=M[lv]||10227;
    var tc=(T+m)*dur,mo=sal<=25000?0:Math.round(((sal-25000)*0.09)/12);
    return fetch(A+'/api/shopify/quiz-sync',{method:'POST',
      headers:{'Content-Type':'application/json','x-integration-secret':B},
      body:JSON.stringify({quizType:'finance',email:email,tuitionFee:String(T),maintenanceLoan:String(m),totalEstimate:String(tc),livingLocation:mL(lv),householdIncome:'0',inputs:{courseDuration:dur,expectedSalary:sal,livingLocation:lv,monthlyRepayment:mo}})
    }).then(function(r){return r.json();});
  }
  function patch(){
    var es=document.getElementById('fc-save-email'),as=document.getElementById('fc-save-auth');
    if(es)es.style.display='';if(as)as.style.display='none';
    if(!window.FC)return false;
    window.FC.saveWithEmail=function(){
      var e=((document.getElementById('fc-email')||{}).value||'').trim();
      if(!e||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)){var s=document.getElementById('fc-save-email-status');if(s){s.textContent='Please enter a valid email';s.style.color='#ef4444';}return;}
      var st=document.getElementById('fc-save-email-status');
      if(st){st.textContent='Saving...';st.style.color='#666';}
      sync(e).then(function(r){if(st){st.textContent=r.success?'\u2713 Saved! Check your dashboard at eduforyou.co.uk':'Failed to save. Please try again.';st.style.color=r.success?'#10b981':'#ef4444';}}).catch(function(){if(st){st.textContent='Failed to save. Please try again.';st.style.color='#ef4444';}});
    };
    return true;
  }
  var a=0,iv=setInterval(function(){a++;if(patch()||a>=50)clearInterval(iv);},100);
})();`;
  res.send(code);
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
app.use('/admin', adminRoutes);

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
  // Handle CORS errors specifically
  if (err.message === 'Not allowed by CORS') {
    logger.warn('CORS rejected', { origin: req.headers.origin, path: req.path });
    return res.status(403).json({ error: 'CORS: origin not allowed', origin: req.headers.origin });
  }
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
