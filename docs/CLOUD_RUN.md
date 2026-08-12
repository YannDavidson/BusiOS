# Google Cloud Run deployment

Deployment target:

- Project: `gen-lang-client-0812085032`
- Region: `us-central1`
- Service: `busios-ai`
- Artifact Registry: `busios`

The deployment uses GitHub OIDC and Google Workload Identity Federation. It does not use a downloadable service-account key. Google recommends Workload Identity Federation over long-lived JSON credentials.

## 1. Bootstrap Google Cloud

Open Google Cloud Shell, clone this repository, and run:

```bash
chmod +x scripts/bootstrap-gcp.sh
./scripts/bootstrap-gcp.sh
```

The script enables the required APIs, creates Artifact Registry, creates least-purpose deploy/runtime service accounts, configures GitHub identity federation for `YannDavidson/BusiOS`, creates empty Secret Manager resources, and prints two GitHub variable values.

## 2. Add GitHub repository variables

In GitHub, open **Settings → Secrets and variables → Actions → Variables**, and create:

- `GCP_WIF_PROVIDER` — exact provider value printed by the script
- `GCP_DEPLOY_SERVICE_ACCOUNT` — exact service-account email printed by the script

These are identifiers, not secret credentials.

## 3. Add Secret Manager values

Run each command in Cloud Shell. The terminal prompts invisibly; the value is sent directly to Secret Manager and is not saved in shell history.

```bash
read -rsp 'Gemini API key: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-gemini-api-key --data-file=-; unset VALUE; echo
read -rsp 'Twilio Account SID: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-twilio-account-sid --data-file=-; unset VALUE; echo
read -rsp 'Twilio Auth Token: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-twilio-auth-token --data-file=-; unset VALUE; echo
read -rsp 'Supabase URL: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-supabase-url --data-file=-; unset VALUE; echo
read -rsp 'Supabase service-role key: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-supabase-service-role-key --data-file=-; unset VALUE; echo
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add busios-app-encryption-key --data-file=-
```

Never place these values in the repository, GitHub variables, screenshots, issues, or chat.

## 4. Initialize Supabase

Open the Supabase SQL editor and run `supabase/migrations/001_initial.sql` once. Confirm the `businesses`, `conversation_states`, and `audit_events` tables exist.

## 5. Deploy

After this deployment pull request is merged, pushes to `main` deploy automatically. You can also open **GitHub Actions → Deploy to Cloud Run → Run workflow**.

The workflow builds the container, pushes an immutable commit-tagged image, deploys it with Secret Manager bindings, allows public webhook requests, and verifies `/health`.

## 6. Connect Twilio WhatsApp Sandbox

Copy the Cloud Run URL shown in the workflow summary. In the Twilio WhatsApp Sandbox configuration, set **When a message comes in** to:

```text
https://YOUR_CLOUD_RUN_HOST/webhooks/twilio/whatsapp
```

Use `POST`, save, join the sandbox from your WhatsApp number, and send `Hello`. Diego should return onboarding question 1/10.

## 7. Verification

- `/health` returns `{ "ok": true, "service": "busios-ai" }`.
- An invalid Twilio signature receives HTTP 403.
- The first valid WhatsApp message starts onboarding.
- Completing 10 answers creates a Supabase conversation state.
- A message beginning `signals:` returns one opportunity card.
- `APPROVE` records authorization but leaves external execution in safe simulation mode.

## Operational safeguards

- Protect the GitHub `production` environment with required approval if desired.
- Keep Cloud Run maximum instances low during the pilot to limit unexpected cost.
- Rotate Twilio, Gemini, and Supabase secrets after suspected exposure.
- Do not enable real outbound execution adapters until idempotency, rate limiting, opt-in compliance, and adapter-specific sandbox tests are complete.
