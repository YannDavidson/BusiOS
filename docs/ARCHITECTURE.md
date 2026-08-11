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

| Agent | Responsibility | MVP status |
|---|---|---|
| Diego | Cross-functional intelligence and owner conversation | Implemented |
| Marisol | Intake, missed calls, appointments | Signal contract |
| Miguel | Campaign creation and marketing | Approval plan |
| Zulma | Lead follow-up and conversion | Planned adapter |
| Enrique | Capacity and operations | Planned adapter |
| Lola | Cash flow and invoices | Planned adapter |
| Julio | Local search visibility | Planned adapter |
| Maria | Reviews and sentiment | Planned adapter |

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
