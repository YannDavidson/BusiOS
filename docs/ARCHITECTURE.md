# Architecture

## System boundary

WhatsApp is the owner interface. Twilio verifies and forwards inbound messages to the API. The orchestrator loads a tenant-scoped Business Brain, routes onboarding or analysis, and records auditable decisions. Gemini generates conversational responses and structured opportunity cards. Supabase persists state and audit events.

## Closed-loop model

1. **Observe:** Marisol and connected systems produce business signals.
2. **Understand:** Diego relates signals to goals, capacity, limits, and historical context.
3. **Predict:** The model estimates impact and states confidence.
4. **Recommend:** One focused, evidence-linked action is proposed.
5. **Approve:** The owner explicitly authorizes or modifies consequential work.
6. **Execute:** Specialist adapters perform configured actions. The MVP uses safe simulation until adapters are verified.
7. **Measure:** Result events are compared with the predicted impact.
8. **Learn:** Outcomes update the Business Brain without overwriting source evidence.

## Agent responsibilities

The canonical persona definitions live in `src/agents/registry.ts`. Every specialist reports to Diego, the Chief Intelligence Officer. Diego remains the single owner-facing coordinator: he routes work, preserves specialist attribution, resolves cross-functional conflicts, requests approval, and measures results. Personas define reasoning and communication behavior; adapters determine which external actions are actually available.

| Agent | Responsibility | MVP status |
|---|---|---|
| Diego (CIO) | Cross-functional intelligence and owner conversation | Implemented |
| Marisol | Intake, missed calls, appointments | Persona + signal contract |
| Miguel | Campaign creation and marketing | Persona + approval plan |
| Zulma | Lead follow-up and conversion | Persona; planned adapter |
| Enrique | Capacity and operations | Persona; planned adapter |
| Lola | Cash flow and invoices | Persona; planned adapter |
| Julio | Local search visibility | Persona; planned adapter |
| Maria | Reviews and sentiment | Persona; planned adapter |

Each persona specifies its mission, personality, voice, expertise, responsibilities, inputs, outputs, tools, collaborators, escalation rules, guardrails, execution authority, and supported languages (English, Spanish, and Portuguese).

## Google ADK pilot

The optional ADK adapter converts the canonical registry into `LlmAgent` definitions with Diego as the root coordinator. Miguel and Lola are the initial pilot specialists. Supabase remains the durable session/task authority, Live Knowledge Drive supplies tenant-scoped cited context, and the verified action gateway is the only available action boundary. The legacy runtime remains the production default and immediate fallback. Marisol's realtime audio transport is not routed through this adapter. See [Google ADK Runtime](GOOGLE_ADK_RUNTIME.md).

## Safety and privacy

- Twilio webhook signatures are mandatory outside tests.
- Production refuses to start without persistent storage, encryption configuration, and required credentials.
- Phone numbers and authorization headers are redacted from application logs.
- Opportunity execution requires explicit owner approval.
- The service role remains server-side; database tables have RLS enabled.
- Audit events preserve proposals, approvals, and eventual execution results.

## Next architecture milestones

- Encrypt sensitive Business Brain fields using envelope encryption/KMS.
- Replace phone-only identity with verified owner and business membership records.
- Add idempotency using Twilio MessageSid.
- Add a durable job queue for outbound actions and retries.
- Add OAuth connectors for calendars, CRM, accounting, and social channels.
- Add policy/risk tiers so high-risk actions require stronger confirmation.
