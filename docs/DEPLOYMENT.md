# Deployment and WhatsApp setup

## 1. Prerequisites

- Node.js 22+
- Gemini API key
- Supabase project
- Twilio account with WhatsApp Sandbox or an approved sender
- HTTPS deployment target such as Cloud Run, Railway, Render, Fly.io, or a container host

## 2. Database

Run `supabase/migrations/001_initial.sql` in the Supabase SQL editor. Use the service-role key only in the server environment.

## 3. Configuration

Copy `.env.example` to `.env` locally. In production, configure all variables in the hosting secret manager. `PUBLIC_BASE_URL` must exactly match the public HTTPS origin Twilio calls.

## 4. Validate

```bash
npm ci
npm run check
docker build -t busios-ai .
```

## 5. Deploy

Deploy the container, expose port 8080, and verify `GET /health` returns `{ "ok": true }`. Never deploy `.env`.

## 6. Configure Twilio

In the Twilio WhatsApp sender or Sandbox settings, set **When a message comes in** to:

`POST https://YOUR_DOMAIN/webhooks/twilio/whatsapp`

Send a test message from an enrolled WhatsApp number. Diego should answer with onboarding question 1/10. Signature failures usually mean `PUBLIC_BASE_URL` differs from the exact webhook URL.

## 7. Production readiness gate

Before contacting real customers:

- publish privacy policy, terms, support contact, and data-deletion process;
- configure retention and encrypted backups;
- implement Twilio MessageSid idempotency and rate limits;
- complete WhatsApp opt-in/template compliance;
- verify each external execution adapter in sandbox mode;
- run tenant-isolation, prompt-injection, and incident-response tests;
- obtain owner approval before changing from simulated to live execution.
