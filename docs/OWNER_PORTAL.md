# BusiOS Owner Portal

The owner portal is served by the existing Cloud Run service at `/portal`. It uses Supabase passwordless email authentication and server-verified tenant memberships; the browser never receives the Supabase service-role key.

## First-run flow

1. Enter an owner email and follow the Supabase magic link.
2. Create a business workspace. BusiOS atomically creates the tenant, owner membership, pilot billing account, and agent configuration.
3. Connect Google Calendar.
4. Configure Marisol's business name, language, greeting, transfer number, Twilio number, and realtime voice setting.
5. Enable the appropriate specialist agents.
6. Review monthly usage and plan state.

## Security boundaries

- Every portal API resolves the caller from a Supabase access token.
- Every tenant read requires membership; configuration writes require `owner` or `admin`.
- Business creation runs through a service-role-only database function.
- A Twilio number already assigned to another tenant cannot be reassigned through the portal.
- Calendar credentials remain encrypted and are never returned by portal APIs.
- Access tokens are kept in browser session storage and disappear when the browser session ends.

## Deployment

Apply migration `008_owner_portal.sql` before merging. Configure the Supabase Auth Site URL as the Cloud Run URL and add this redirect URL:

```text
https://busios-ai-w2pzlhwnxa-uc.a.run.app/portal
```

The current billing card reports plan and metered usage. It does not collect payment; Stripe checkout and subscription lifecycle are a separate verified integration.
