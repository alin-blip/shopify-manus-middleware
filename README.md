# Shopify ↔ Manus EduForYou Integration

Acest proiect conține integrarea completă bidirecțională între magazinul Shopify (`ykiysp-be.myshopify.com`) și platforma educațională Manus EduForYou (`eduforyou.co.uk`).

## Arhitectura Soluției

Integrarea rezolvă cele 4 cerințe principale prin intermediul unui server middleware (Node.js/Express) și al modificărilor în fișierele Liquid din Shopify:

1. **Shopify → Manus (Orders)**: Webhook-uri Shopify (`orders/create`, `orders/updated`) trimit datele comenzilor către serverul de integrare, care le sincronizează cu backend-ul Manus prin tRPC, asociindu-le profilului de student pe baza adresei de email.
2. **Shopify → Manus (Quizuri)**: Fișierele Liquid modificate comunică direct cu serverul de integrare via API REST. La finalizarea unui quiz (Eligibility, Ikigai, Finance), datele sunt trimise către Manus și asociate contului de student.
3. **Auth Flow (SSO)**:
   - Sesiunea Manus generează un token JWT de integrare.
   - La navigarea către Shopify, token-ul este pasat prin URL (`?manus_token=...`).
   - Shopify salvează token-ul și îl folosește pentru a trimite date (quizuri) autentificate.
   - Snippet-ul `manus-auth-gate.liquid` poate bloca accesul la checkout dacă utilizatorul nu are o sesiune Manus activă.
   - După checkout, `checkout-redirect.liquid` redirecționează utilizatorul înapoi în dashboard-ul Manus, restabilind sesiunea.
4. **Conturi Unice**: Identificatorul unic (sursa de adevăr) este adresa de email. Dacă un utilizator plasează o comandă pe Shopify fără a fi logat, serverul de integrare va face `upsert` pe adresa de email în baza de date Manus.

---

## 1. Configurarea Serverului de Integrare

Serverul este construit în Node.js (Express) și servește ca punte între Shopify și API-ul tRPC din Manus.

### Deployment (Vercel, Render, Heroku, etc.)
1. Clonează acest repository (directorul `shopify-manus-integration`).
2. Instalează dependențele: `npm install`
3. Configurează variabilele de mediu (`.env`):
   ```env
   NODE_ENV=production
   PORT=3000

   # Shopify Dev App Credentials
   SHOPIFY_STORE_DOMAIN=ykiysp-be.myshopify.com
   SHOPIFY_API_VERSION=2024-01
   SHOPIFY_CLIENT_ID=7f630fbb79b54b156610dbc7b3a91c7e
   SHOPIFY_CLIENT_SECRET=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
   SHOPIFY_WEBHOOK_SECRET=your_webhook_signing_secret_here

   # Manus EduForYou
   MANUS_BASE_URL=https://www.eduforyou.co.uk
   MANUS_API_URL=https://www.eduforyou.co.uk/api/trpc

   # Integration JWT Secret
   INTEGRATION_JWT_SECRET=generate_a_strong_random_string_here
   ```
4. Pornește serverul: `npm start`

---

## 2. Configurarea Webhooks în Shopify

Pentru a sincroniza comenzile și clienții, trebuie să configurezi Webhook-uri în Shopify Admin.

1. Mergi la **Settings > Notifications** în Shopify Admin.
2. La secțiunea **Webhooks**, apasă pe **Create webhook**.
3. Configurează următoarele 4 webhook-uri:

| Event | Format | URL |
|-------|--------|-----|
| Order creation | JSON | `https://[URL_SERVER]/webhooks/orders/create` |
| Order update | JSON | `https://[URL_SERVER]/webhooks/orders/updated` |
| Customer creation | JSON | `https://[URL_SERVER]/webhooks/customers/create` |
| Customer update | JSON | `https://[URL_SERVER]/webhooks/customers/update` |

*Notă: După salvare, Shopify îți va afișa un secret de semnare (Webhook signing secret) în partea de jos a paginii Notifications. Copiază acel secret și pune-l în variabila `SHOPIFY_WEBHOOK_SECRET` de pe serverul tău.*

---

## 3. Implementarea în Shopify Liquid

Fișierele modificate se găsesc în folderul `shopify-liquid/`.

### 3.1. Quiz-urile
Înlocuiește conținutul actual al fișierelor din tema ta Shopify cu variantele modificate:
- `eligibility-quiz.liquid`
- `ikigai-quiz.liquid`
- `finance-calculator.liquid`

*Important:* În Customizer (sau direct în cod), setează `Integration Server URL` cu URL-ul unde ai făcut deploy la serverul Node.js.

### 3.2. Flow-ul de Autentificare și Redirect
Pentru a forța utilizatorii să fie logați în Manus înainte de checkout și pentru a-i redirecționa înapoi după plată:

1. **Gate-ul de Autentificare**:
   Adaugă snippet-ul `manus-auth-gate.liquid` în tema ta (ideal în `theme.liquid` chiar înainte de `</body>` sau pe pagina de cart).
   ```liquid
   {% render 'manus-auth-gate' %}
   ```

2. **Redirect-ul Post-Checkout**:
   În Shopify Admin, mergi la **Settings > Checkout > Order status page** (sau în secțiunea de extensii de checkout dacă folosești Checkout Extensibility).
   Adaugă codul din `checkout-redirect.liquid` în secțiunea "Additional scripts". Acest script va redirecționa automat clientul către `https://www.eduforyou.co.uk/student/dashboard` prin intermediul serverului de integrare.

---

## 4. Modificări necesare în aplicația Manus (EduForYou)

Deoarece aplicația EduForYou folosește tRPC, trebuie să expui procedurile necesare pentru ca serverul de integrare să poată comunica cu baza de date.

În router-ul tRPC al aplicației (ex: `src/server/api/routers/integration.ts`), adaugă:

1. `integration.syncOrder`: Primește payload-ul comenzii și face upsert în baza de date.
2. `integration.syncQuiz`: Primește rezultatele quiz-urilor și le leagă de profilul studentului.
3. `integration.upsertStudent`: Creează contul (fără parolă, bazat pe email) dacă studentul nu există deja, atunci când vine din Shopify.

Pentru detalii complete despre structura de date așteptată, consultă fișierul `src/routes/manusIntegration.js` din acest repository, care servește ca documentație a contractului API sau ca adaptor/proxy fallback.
