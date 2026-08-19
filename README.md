# BusiOS AI™

**The AI Operating System for Small Business**

BusiOS gives small-business owners one AI operating team through WhatsApp. Diego, the owner-facing intelligence agent, learns the business, connects signals across specialist agents, recommends the most useful next action, and coordinates execution only after explicit owner approval.

## The defining loop

**Observe → Understand → Predict → Recommend → Approve → Execute → Measure → Learn**

This repository contains the first deployable vertical slice: conversational WhatsApp onboarding, a structured Business Brain, Gemini-powered Diego conversations, evidence-linked opportunity cards, approval controls, Supabase persistence, audit events, Twilio verification, tests, and container deployment.

## Quick start

```bash
cp .env.example .env
npm ci
npm run check
npm run dev
```

The local service listens on port `8080`. `GET /health` reports readiness. A complete setup requires Gemini, Twilio WhatsApp, and Supabase credentials; see [Deployment](docs/DEPLOYMENT.md).

## WhatsApp experience

1. The owner messages Diego and answers 10 short onboarding questions.
2. Answers seed one tenant-scoped Business Brain.
3. Normal messages receive context-aware operational guidance.
4. A message beginning with `signals:` asks Diego to connect cross-functional evidence.
5. Diego returns one opportunity with predicted impact and confidence.
6. `APPROVE` records authorization; external execution remains simulated until its adapter is verified.

## AI workforce

| Agent | Focus |
|---|---|
| Marisol | Reception, intake, appointments |
| Miguel | Marketing and promotions |
| Zulma | Sales and follow-up |
| Enrique | Operations and capacity |
| Lola | Finance and invoices |
| Julio | Local SEO and visibility |
| Maria | Reviews and reputation |
| Diego | Business intelligence and orchestration |

## Project map

- `src/` — webhook, onboarding, orchestration, Gemini intelligence, storage
- `tests/` — business-flow and safety tests
- `supabase/migrations/` — initial persistence and audit schema
- `docs/ARCHITECTURE.md` — system boundaries, safety, and agent model
- `docs/MULTI_AGENT_RUNTIME.md` — durable team lifecycle and WhatsApp commands
- `docs/MARISOL_VOICE.md` — tenant voice provisioning, Twilio webhooks, and call lifecycle
- `docs/REALTIME_VOICE.md` — bidirectional audio, interruption, recovery, and usage limits
- `docs/VERIFIED_PHONE_ACTIONS.md` — consent, approvals, connectors, receipts, usage, and billing
- `docs/GOOGLE_CALENDAR_OAUTH.md` — tenant-authorized Calendar OAuth, selection, and revocation
- `docs/OWNER_PORTAL.md` — passwordless tenant onboarding and owner command center
- `docs/LIVE_KNOWLEDGE_DRIVE.md` — tenant Drive folders, safe ingestion, synchronization, citations, and retrieval
- `docs/GOOGLE_ADK_RUNTIME.md` — opt-in ADK team, pilot controls, evaluations, and fallback
- `docs/STRIPE_BILLING.md` — pricing, Checkout, webhooks, entitlements, and Customer Portal
- `docs/DEPLOYMENT.md` — production and Twilio setup
- `docs/CLOUD_RUN.md` — Google Cloud bootstrap and automated deployment
- `docs/PRODUCT.md` — scope, success metrics, pilot, and roadmap

## Product principles

- WhatsApp-first and low-friction
- One shared Business Brain per company
- Human approval before consequential actions
- Evidence-linked recommendations and measurable outcomes
- Privacy, tenant isolation, auditability, and safe defaults

## Current boundary

This is a deployment-ready **MVP foundation**, not an unsupervised autonomous business operator. Real outbound campaigns, calendar changes, accounting actions, and customer follow-ups require separately configured and tested adapters. The MVP deliberately records approvals and simulates execution to prevent false claims or accidental live actions.

## License

Copyright © 2026 CSIX AI LABS LLC. All rights reserved. See [LICENSE](LICENSE).
