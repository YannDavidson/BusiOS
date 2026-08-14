# Google Calendar OAuth onboarding

BusiOS connects one Google Calendar account per business through a server-side OAuth 2.0 authorization-code flow with PKCE. Only authenticated Supabase users listed as an `owner` or `admin` in `business_memberships` can connect, inspect, change, or disconnect a business calendar.

## Google Cloud configuration

Enable the Calendar API and create a Web OAuth client. Its exact redirect URI is:

```text
https://busios-ai-w2pzlhwnxa-uc.a.run.app/integrations/google/calendar/callback
```

The consent screen must request:

- `calendar.events` to create approved appointments
- `calendar.calendarlist.readonly` to show writable calendar choices

Store the client values in Secret Manager as `busios-google-oauth-client-id` and `busios-google-oauth-client-secret`. Never put either value in the repository.

## Tenant setup

Apply migration `007_google_calendar_oauth.sql`, then associate a Supabase Auth user with the business:

```sql
insert into business_memberships (business_id, user_id, role)
values ('BUSINESS_UUID', 'SUPABASE_AUTH_USER_UUID', 'owner')
on conflict (business_id, user_id) do update set role = excluded.role;
```

Call authenticated management endpoints with a Supabase access token:

```text
Authorization: Bearer SUPABASE_ACCESS_TOKEN
X-BusiOS-Business-ID: BUSINESS_UUID
```

## Endpoints

- `GET /integrations/google/calendar/connect` returns a ten-minute Google authorization URL.
- `GET /integrations/google/calendar/callback` validates and consumes state, exchanges the code, encrypts the refresh token, and selects the primary writable calendar.
- `GET /integrations/google/calendar/status` returns connection metadata but never credentials.
- `POST /integrations/google/calendar/select` accepts `{ "calendarId": "..." }` and verifies that the calendar is writable.
- `DELETE /integrations/google/calendar` revokes the Google refresh token before clearing the encrypted credential.

Raw OAuth state and refresh tokens are never stored. State is SHA-256 hashed, expires after ten minutes, is consumed atomically, and cannot be replayed. The PKCE verifier and refresh token use the existing AES-256-GCM credential vault.

## Operations

Periodically invoke `select purge_expired_oauth_authorization_states();` through a Supabase scheduled job. If a user removes BusiOS from their Google account, disconnect the integration or reconnect it to replace the invalid refresh token.
