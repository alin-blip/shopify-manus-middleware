# Ghid Complet de Deployment — Integrare Shopify ↔ Manus EduForYou

**Autor:** Manus AI  
**Data:** 23 Martie 2026  
**Versiune:** 1.0

---

## Cuprins

1. [Prezentare Generală](#1-prezentare-generală)
2. [Arhitectura Sistemului](#2-arhitectura-sistemului)
3. [Structura Fișierelor](#3-structura-fișierelor)
4. [Configurarea Serverului de Integrare](#4-configurarea-serverului-de-integrare)
5. [Configurarea Webhooks în Shopify Admin](#5-configurarea-webhooks-în-shopify-admin)
6. [Implementarea Fișierelor Liquid în Shopify](#6-implementarea-fișierelor-liquid-în-shopify)
7. [Modificări Necesare în Backend-ul Manus (EduForYou)](#7-modificări-necesare-în-backend-ul-manus-eduforyou)
8. [Flow-uri Detaliate](#8-flow-uri-detaliate)
9. [Testare și Verificare](#9-testare-și-verificare)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prezentare Generală

Această integrare conectează magazinul Shopify (`ykiysp-be.myshopify.com`) cu platforma educațională Manus EduForYou (`eduforyou.co.uk`) prin intermediul unui server middleware Node.js/Express. Serverul acționează ca punte de comunicare, gestionând autentificarea cross-platform, sincronizarea datelor și rutarea evenimentelor.

Soluția rezolvă patru cerințe fundamentale: sincronizarea comenzilor Shopify cu dashboard-ul studentului din Manus, transmiterea rezultatelor quiz-urilor din paginile Liquid către profilul studentului, un flow de autentificare SSO care permite navigarea fără fricțiune între cele două platforme, și un mecanism de conturi unice bazat pe adresa de email ca identificator universal.

Platforma EduForYou folosește un stack tehnic bazat pe **React + Vite** pentru frontend, **tRPC** pentru comunicarea client-server, și **JWT Bearer tokens** (`edu_session_token` în localStorage) pentru autentificare. Serverul de integrare se adaptează acestui stack prin generarea de token-uri JWT compatibile și prin comunicarea cu endpoint-urile tRPC existente.

---

## 2. Arhitectura Sistemului

Diagrama de mai jos ilustrează fluxul de date între cele trei componente principale:

```
┌──────────────────────┐         ┌─────────────────────────┐         ┌──────────────────────┐
│   SHOPIFY STORE      │         │  INTEGRATION SERVER     │         │  MANUS EDUFORYOU     │
│  ykiysp-be.myshopify │         │  (Node.js / Express)    │         │  eduforyou.co.uk     │
│                      │         │                         │         │                      │
│  ┌────────────────┐  │ webhook │  ┌─────────────────┐   │  tRPC   │  ┌────────────────┐  │
│  │ Orders/Create  │──┼────────>│  │ /webhooks/*     │───┼────────>│  │ Student Profile │  │
│  │ Orders/Updated │  │         │  │ HMAC verified   │   │         │  │ Orders tab     │  │
│  └────────────────┘  │         │  └─────────────────┘   │         │  └────────────────┘  │
│                      │         │                         │         │                      │
│  ┌────────────────┐  │  fetch  │  ┌─────────────────┐   │  tRPC   │  ┌────────────────┐  │
│  │ Liquid Pages   │──┼────────>│  │ /quiz/*         │───┼────────>│  │ Quiz Results   │  │
│  │ (eligibility,  │  │         │  │ JWT optional    │   │         │  │ in Profile     │  │
│  │  ikigai,       │  │         │  └─────────────────┘   │         │  └────────────────┘  │
│  │  finance)      │  │         │                         │         │                      │
│  └────────────────┘  │         │  ┌─────────────────┐   │         │  ┌────────────────┐  │
│                      │         │  │ /auth/*         │   │         │  │ Auth System    │  │
│  ┌────────────────┐  │ redirect│  │ SSO flow        │<──┼────────>│  │ JWT tokens     │  │
│  │ Checkout       │──┼────────>│  │ Token exchange  │   │         │  │ edu_session_   │  │
│  │ Thank You Page │  │         │  └─────────────────┘   │         │  │ token          │  │
│  └────────────────┘  │         │                         │         │  └────────────────┘  │
│                      │         │  ┌─────────────────┐   │         │                      │
│                      │         │  │ /manus/*        │   │         │                      │
│                      │         │  │ Data store /    │   │         │                      │
│                      │         │  │ adapter layer   │   │         │                      │
│                      │         │  └─────────────────┘   │         │                      │
└──────────────────────┘         └─────────────────────────┘         └──────────────────────┘
```

Serverul de integrare expune următoarele grupuri de endpoint-uri:

| Grup | Prefix | Scop |
|------|--------|------|
| Webhooks | `/webhooks/*` | Primește evenimente Shopify (orders, customers) |
| Quiz | `/quiz/*` | Primește rezultate quiz-uri din Liquid pages |
| Auth | `/auth/*` | Gestionează SSO și token exchange |
| Manus | `/manus/*` | Adaptor/proxy pentru datele din Manus DB |
| Health | `/health` | Monitorizare și diagnosticare |

---

## 3. Structura Fișierelor

```
shopify-manus-integration/
├── src/
│   ├── config.js                    # Configurare centralizată (env vars)
│   ├── server.js                    # Entry point Express
│   ├── middleware/
│   │   ├── shopifyWebhook.js        # Verificare HMAC Shopify
│   │   └── authToken.js             # Verificare JWT integrare
│   ├── routes/
│   │   ├── webhooks.js              # Handlers: orders/create, orders/updated, etc.
│   │   ├── quiz.js                  # Handlers: eligibility, ikigai, finance
│   │   ├── auth.js                  # SSO: shopify-redirect, manus-redirect, etc.
│   │   ├── manusIntegration.js      # Adaptor/proxy: sync-order, sync-quiz, etc.
│   │   └── health.js                # Health check
│   ├── services/
│   │   ├── manusApi.js              # Client tRPC pentru Manus backend
│   │   └── shopifyApi.js            # Client REST pentru Shopify Admin API
│   └── utils/
│       ├── crypto.js                # HMAC, JWT sign/verify
│       └── logger.js                # Winston logger
├── shopify-liquid/
│   ├── eligibility-quiz.liquid      # Quiz eligibilitate (modificat)
│   ├── ikigai-quiz.liquid           # Quiz Ikigai (modificat)
│   ├── finance-calculator.liquid    # Calculator finanțe (modificat)
│   ├── checkout-redirect.liquid     # Redirect post-checkout → Manus
│   └── manus-auth-gate.liquid       # Gate autentificare pe Shopify
├── docs/
│   └── DEPLOYMENT_GUIDE.md          # Acest document
├── package.json
├── .env.example
└── README.md
```

---

## 4. Configurarea Serverului de Integrare

### 4.1. Cerințe Sistem

Serverul necesită Node.js 18+ și npm. Poate fi deployat pe orice platformă care suportă aplicații Node.js: **Render**, **Railway**, **Heroku**, **Vercel** (cu adaptare serverless), **AWS EC2/ECS**, **DigitalOcean App Platform**, sau un VPS propriu.

### 4.2. Instalare

```bash
# Clonează sau copiază directorul shopify-manus-integration
cd shopify-manus-integration

# Instalează dependențele
npm install

# Creează fișierul .env din exemplu
cp .env.example .env
```

### 4.3. Variabile de Mediu

Editează fișierul `.env` cu valorile corecte:

```env
# ── General ──
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# ── Shopify Dev App ──
SHOPIFY_STORE_DOMAIN=ykiysp-be.myshopify.com
SHOPIFY_API_VERSION=2024-01
SHOPIFY_CLIENT_ID=7f630fbb79b54b156610dbc7b3a91c7e
SHOPIFY_CLIENT_SECRET=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
SHOPIFY_WEBHOOK_SECRET=<webhook_signing_secret_din_shopify_admin>
SHOPIFY_ACCESS_TOKEN=<access_token_din_custom_app>

# ── Manus EduForYou ──
MANUS_BASE_URL=https://www.eduforyou.co.uk
MANUS_API_URL=https://www.eduforyou.co.uk/api/trpc

# ── Integration JWT ──
INTEGRATION_JWT_SECRET=<generează_un_string_random_de_64_caractere>
INTEGRATION_TOKEN_EXPIRY=24h

# ── CORS ──
ALLOWED_ORIGINS=https://www.eduforyou.co.uk,https://eduforyou.co.uk,https://ykiysp-be.myshopify.com
```

Pentru a genera un secret JWT securizat, rulează:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4.4. Pornire

```bash
# Development
npm run dev

# Production
npm start
```

Verifică funcționarea accesând `https://[URL_SERVER]/health`.

### 4.5. Deployment pe Render (recomandat)

Render oferă deployment simplu pentru aplicații Node.js cu HTTPS automat:

1. Creează un cont pe [render.com](https://render.com).
2. Conectează repository-ul Git sau fă upload manual.
3. Creează un **Web Service** cu:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Adaugă toate variabilele de mediu din secțiunea Environment.
5. După deploy, notează URL-ul public (ex: `https://shopify-manus-integration.onrender.com`).

---

## 5. Configurarea Webhooks în Shopify Admin

### 5.1. Pași de Configurare

1. Accesează **Shopify Admin** → **Settings** → **Notifications**.
2. Scroll în jos până la secțiunea **Webhooks**.
3. Apasă **Create webhook** și configurează fiecare webhook conform tabelului de mai jos.

### 5.2. Webhooks Necesare

| # | Event | Format | Webhook URL | API Version |
|---|-------|--------|-------------|-------------|
| 1 | Order creation | JSON | `https://[URL_SERVER]/webhooks/orders/create` | 2024-01 |
| 2 | Order update | JSON | `https://[URL_SERVER]/webhooks/orders/updated` | 2024-01 |
| 3 | Customer creation | JSON | `https://[URL_SERVER]/webhooks/customers/create` | 2024-01 |
| 4 | Customer update | JSON | `https://[URL_SERVER]/webhooks/customers/update` | 2024-01 |

Înlocuiește `[URL_SERVER]` cu URL-ul real al serverului de integrare (ex: `https://shopify-manus-integration.onrender.com`).

### 5.3. Webhook Signing Secret

După salvarea primului webhook, Shopify afișează un **Webhook signing secret** în partea de jos a paginii Notifications. Acesta arată astfel: `whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Copiază acest secret și setează-l ca valoare pentru `SHOPIFY_WEBHOOK_SECRET` în `.env`.

### 5.4. Verificare

Shopify permite trimiterea unui webhook de test. Apasă **Send test notification** pentru fiecare webhook și verifică în logurile serverului de integrare că evenimentele sunt primite și procesate corect.

---

## 6. Implementarea Fișierelor Liquid în Shopify

### 6.1. Quiz-urile Modificate

Fiecare fișier Liquid din `shopify-liquid/` trebuie copiat în tema Shopify, înlocuind versiunea existentă.

**Metoda 1 — Prin Shopify Admin (Online Store > Themes > Edit Code):**

1. Mergi la **Online Store** → **Themes** → **...** → **Edit code**.
2. În secțiunea **Sections**, caută fișierele existente pentru eligibility, ikigai și finance.
3. Înlocuiește conținutul cu cel din fișierele modificate.
4. Salvează fiecare fișier.

**Metoda 2 — Prin Shopify CLI:**

```bash
shopify theme push --path ./shopify-liquid/ --store ykiysp-be.myshopify.com
```

### 6.2. Configurarea URL-ului Serverului de Integrare

După ce fișierele Liquid sunt în temă, trebuie configurat URL-ul serverului de integrare:

1. Mergi la **Online Store** → **Themes** → **Customize**.
2. Navighează la fiecare pagină de quiz (Eligibility, Ikigai, Finance Calculator).
3. Selectează secțiunea quiz-ului și completează câmpul **Integration Server URL** cu URL-ul serverului tău (ex: `https://shopify-manus-integration.onrender.com`).

### 6.3. Snippet-ul de Redirect Post-Checkout

Adaugă codul din `checkout-redirect.liquid` în **Settings** → **Checkout** → **Order status page** → **Additional scripts**. Asigură-te că variabila `INTEGRATION_SERVER_URL` din script este setată corect.

### 6.4. Gate-ul de Autentificare (Opțional)

Dacă dorești să blochezi checkout-ul pentru utilizatorii neautentificați în Manus:

1. Copiază `manus-auth-gate.liquid` ca snippet în temă (în directorul `snippets/`).
2. Adaugă `{% render 'manus-auth-gate' %}` în `theme.liquid`, chiar înainte de `</body>`.
3. Activează setarea `require_manus_auth` din Theme Settings dacă dorești blocarea efectivă.

---

## 7. Modificări Necesare în Backend-ul Manus (EduForYou)

Serverul de integrare comunică cu backend-ul Manus prin tRPC. Pentru funcționalitate completă, trebuie adăugate următoarele proceduri tRPC în aplicația EduForYou.

### 7.1. Router de Integrare (tRPC)

Creează un nou router `integration` în backend-ul tRPC al aplicației. Fișierul de referință este `src/routes/manusIntegration.js` din acest proiect, care documentează exact contractul API așteptat.

Procedurile necesare:

| Procedură | Tip | Descriere |
|-----------|-----|-----------|
| `integration.syncOrder` | mutation | Primește datele unei comenzi Shopify și le salvează în profilul studentului |
| `integration.syncQuiz` | mutation | Primește rezultatele unui quiz și le asociază profilului |
| `integration.upsertStudent` | mutation | Creează sau actualizează un student pe baza email-ului |
| `integration.findByEmail` | query | Caută un student după email |
| `integration.createSession` | mutation | Generează un token de sesiune pentru un student (pentru SSO) |

### 7.2. Adaptor/Proxy Fallback

Dacă modificarea directă a backend-ului Manus nu este posibilă imediat, serverul de integrare include un adaptor local (`/manus/*`) care stochează datele în memorie și le expune prin API REST. Dashboard-ul Manus poate consuma aceste date prin:

```
GET /manus/student/{email}          → Profil complet (student + orders + quizzes)
GET /manus/student/{email}/orders   → Doar comenzile
GET /manus/student/{email}/quizzes  → Doar rezultatele quiz-urilor
```

Acest adaptor este o soluție temporară. Pentru producție, datele trebuie persistate într-o bază de date (PostgreSQL, MySQL, sau direct în baza de date Manus).

### 7.3. Modificări în Frontend-ul Manus

Pentru a afișa datele Shopify în dashboard-ul studentului, adaugă o componentă React care consumă endpoint-urile de mai sus. Componenta ar trebui să afișeze:

- Lista comenzilor Shopify (produse, sumă, dată, status)
- Rezultatele quiz-urilor completate pe Shopify
- Status-ul legăturii cu contul Shopify

---

## 8. Flow-uri Detaliate

### 8.1. Flow A — Student navighează de la Manus la Shopify

```
Student logat în Manus
    │
    ▼
Click pe "Shop" / link Shopify
    │
    ▼
Manus generează URL:
  https://[INTEGRATION_SERVER]/auth/shopify-redirect
    ?manusToken=<edu_session_token>
    &returnUrl=/collections/all
    │
    ▼
Serverul verifică token-ul cu auth.me tRPC
    │
    ▼
Generează integration JWT
    │
    ▼
Redirect 302 → https://ykiysp-be.myshopify.com/collections/all
    ?manus_token=<integration_jwt>
    │
    ▼
Pagina Shopify detectează manus_token din URL
    │
    ▼
Salvează în localStorage + afișează banner "Connected as..."
    │
    ▼
Pre-completează câmpurile de email/nume în quiz-uri
```

### 8.2. Flow B — Student completează un quiz pe Shopify

```
Student pe pagina /pages/eligibility (sau ikigai, finance)
    │
    ▼
Completează quiz-ul
    │
    ▼
JavaScript face fetch() POST către:
  https://[INTEGRATION_SERVER]/quiz/eligibility
  Body: { email, firstName, lastName, results... }
  Header: Authorization: Bearer <integration_jwt> (dacă există)
    │
    ▼
Serverul primește datele
    │
    ▼
Apelează manusApi.syncQuizResults() → tRPC integration.syncQuiz
    │
    ▼
Apelează manusApi.upsertStudent() → tRPC integration.upsertStudent
    │
    ▼
Datele apar în dashboard-ul studentului din Manus
```

### 8.3. Flow C — Comandă Shopify → Dashboard Manus

```
Shopify emite eveniment orders/create
    │
    ▼
Webhook POST → https://[INTEGRATION_SERVER]/webhooks/orders/create
  Header: X-Shopify-Hmac-Sha256: <hmac>
  Body: { order data }
    │
    ▼
Middleware verifică HMAC cu SHOPIFY_WEBHOOK_SECRET
    │
    ▼
Handler extrage: email, produse, sumă, dată
    │
    ▼
manusApi.syncOrderToStudent(orderPayload)
    │
    ▼
manusApi.upsertStudent({ email, firstName, lastName })
    │
    ▼
Datele comenzii apar în dashboard-ul studentului
```

### 8.4. Flow D — Redirect post-checkout

```
Student finalizează checkout pe Shopify
    │
    ▼
Pagina Thank You conține checkout-redirect.liquid
    │
    ▼
Script-ul extrage email + orderId din {{ checkout }}
    │
    ▼
Countdown 5 secunde + redirect automat către:
  https://[INTEGRATION_SERVER]/auth/manus-redirect
    ?email=student@example.com
    &orderId=12345
    │
    ▼
Serverul generează un signed redirect token
    │
    ▼
Redirect 302 → https://www.eduforyou.co.uk/auth/login
    ?shopifyToken=<signed_token>
    &returnTo=/student/dashboard
    │
    ▼
Frontend-ul Manus detectează shopifyToken
    │
    ▼
Apelează /auth/exchange-token pentru a verifica
    │
    ▼
Auto-login (sau pre-fill email) + redirect la dashboard
```

---

## 9. Testare și Verificare

### 9.1. Checklist de Testare

| # | Test | Cum verifici | Rezultat așteptat |
|---|------|-------------|-------------------|
| 1 | Health check | `GET /health` | `{ "status": "ok" }` |
| 2 | Webhook HMAC | Trimite test webhook din Shopify Admin | Log: "Webhook verified: orders/create" |
| 3 | Webhook reject | `POST /webhooks/orders/create` fără HMAC | 401 Unauthorized |
| 4 | Quiz eligibility | Completează quiz-ul pe Shopify | `POST /quiz/eligibility` returnează `{ success: true }` |
| 5 | Quiz ikigai | Completează quiz-ul pe Shopify | `POST /quiz/ikigai` returnează `{ success: true }` |
| 6 | Finance calc | Apasă "Save" pe calculator | `POST /quiz/finance` returnează `{ success: true }` |
| 7 | Auth redirect | Navighează cu `?manus_token=...` | Banner "Connected as..." apare |
| 8 | Post-checkout | Plasează o comandă test (COD) | Redirect automat la Manus dashboard |
| 9 | Student data | `GET /manus/student/test@email.com` | Returnează profil + orders + quizzes |
| 10 | CORS | Fetch din browser de pe eduforyou.co.uk | Nu apare eroare CORS |

### 9.2. Testare Manuală cu cURL

```bash
# Test health
curl https://[URL_SERVER]/health

# Test quiz endpoint
curl -X POST https://[URL_SERVER]/quiz/eligibility \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","firstName":"John","lastName":"Doe","eligible":true}'

# Test student data retrieval
curl https://[URL_SERVER]/manus/student/test@example.com

# Test auth validation
curl -X POST https://[URL_SERVER]/auth/validate-session \
  -H "Content-Type: application/json" \
  -d '{"manusToken":"your_edu_session_token_here"}'
```

### 9.3. Testare Comenzi (Cash on Delivery)

Deoarece Shopify este configurat cu Cash on Delivery pentru teste:

1. Adaugă un produs în coș pe Shopify.
2. Completează checkout-ul cu un email de test.
3. Selectează Cash on Delivery ca metodă de plată.
4. Finalizează comanda.
5. Verifică logurile serverului de integrare pentru webhook-ul `orders/create`.
6. Verifică `GET /manus/student/{email}/orders` pentru datele sincronizate.

---

## 10. Troubleshooting

### Webhook-urile nu ajung la server

Verifică dacă URL-ul serverului este accesibil public (HTTPS obligatoriu). Shopify nu trimite webhook-uri către `localhost` sau URL-uri HTTP. Verifică și dacă `SHOPIFY_WEBHOOK_SECRET` este corect setat.

### Eroare CORS pe paginile Liquid

Asigură-te că domeniul Shopify (`https://ykiysp-be.myshopify.com`) este inclus în `ALLOWED_ORIGINS`. În development, setează `NODE_ENV=development` pentru a permite toate originile.

### Token-ul de integrare expiră

Token-ul JWT de integrare are o durată de viață configurabilă (default: 24h). Dacă studentul rămâne pe Shopify mai mult, token-ul va expira. Mărește `INTEGRATION_TOKEN_EXPIRY` sau implementează un mecanism de refresh.

### Quiz-urile nu se sincronizează

Verifică consola browser-ului pe pagina Liquid pentru erori JavaScript. Asigură-te că `Integration Server URL` este setat corect în Shopify Customizer (fără slash final).

### Datele nu apar în dashboard-ul Manus

Dacă folosești adaptorul fallback (`/manus/*`), datele sunt stocate în memorie și se pierd la restart. Pentru producție, implementează procedurile tRPC descrise în Secțiunea 7 sau adaugă persistență (SQLite/PostgreSQL) la adaptor.

---

> **Notă finală:** Această integrare este proiectată modular. Fiecare componentă (webhooks, quiz sync, auth flow) poate fi activată independent. Începe cu webhook-urile pentru sincronizarea comenzilor, apoi adaugă quiz sync și auth flow pe măsură ce testezi fiecare componentă.
