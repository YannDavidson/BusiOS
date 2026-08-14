# Verified Phone Actions

PR #9 separates a proposed action, owner approval, provider acceptance, and verified completion. A provider SID is not treated as proof of delivery. Twilio messages and calls remain `accepted` until signed status callbacks report a terminal outcome. Google Calendar and the internal CRM return immediate verified resource IDs.

## Supported connectors

- **Google Calendar:** OAuth refresh credentials are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`; only non-secret calendar configuration is stored in plaintext. Event creation returns the Google event ID.
- **BusiOS CRM:** Tenant-scoped contact upsert with a stable external key, such as a phone number or provider customer ID.
- **Twilio SMS/WhatsApp:** Transactional confirmations with signed delivery callbacks.
- **Twilio Voice:** Explicitly approved callbacks with answering-machine detection and signed call-status callbacks.

## Lifecycle

1. Create a proposal with a tenant-unique idempotency key.
2. Record channel- and purpose-specific consent when required.
3. Obtain explicit owner approval.
4. Execute exactly once through the selected connector.
5. Store the provider resource ID as an accepted or verified receipt.
6. Process signed callbacks and update the final receipt.
7. Append usage events for billing and cost reporting.

Marketing consent is intentionally distinct from service, appointment, transactional-message, and callback consent. PR #9 does not enable marketing calls or campaigns.

## Usage and billing

`usage_events` is an immutable metering ledger. `business_usage_monthly` aggregates quantity and estimated cost by tenant, month, and metric. `billing_accounts` stores plan and included-unit configuration. These records support invoices and future Stripe integration but do not charge a customer.

Initial metrics include CRM writes, calendar events, message attempts/segments, outbound call attempts, and completed call seconds. Provider prices are stored as estimates only when known; final invoice logic must use provider billing data and the BusiOS plan.

## Configuration still required after merge

- Create a Google OAuth web client and add its client ID/secret to Secret Manager.
- Build the owner-facing OAuth authorization callback to encrypt and persist each business refresh token.
- Share/select the target calendar and store its ID in `integration_connections.config`.
- Configure the Twilio message and call status URLs if provider defaults do not use the per-request callbacks.
- Insert consent based on evidence collected during a call, message, web form, or owner import.
