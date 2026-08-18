# BusiOS Live Knowledge Drive

Live Knowledge Drive lets each business maintain a dedicated Google Drive folder while BusiOS synchronizes approved content into its tenant-isolated Business Brain. Agents never receive Google credentials or unrestricted Drive access. Retrieval is mediated by BusiOS, restricted by business and agent, and returned with a source citation.

## Supported sources

- Google Docs (exported as plain text)
- Google Sheets (exported as CSV)
- PDF
- DOCX
- CSV
- plain text

Files are limited to 10 MB and 500,000 extracted characters. A knowledge folder is limited to 2,000 files. Unsupported files are recorded but not indexed. Suspicious instruction patterns are quarantined with no searchable chunks.

## Connection lifecycle

1. An owner or admin starts OAuth with PKCE and a ten-minute, single-use state.
2. BusiOS requests the narrow `drive.file` scope and stores the refresh token in an AES-256-GCM credential envelope.
3. BusiOS creates `BusiOS — Business Name — UUID` and eleven starter folders, or the owner chooses an app-authorized folder with Google Picker.
4. Initial scan exports, parses, versions, classifies, chunks, and indexes supported files.
5. A Google Drive change channel calls `/webhooks/google/drive`; its random channel token is stored only as a hash.
6. BusiOS consumes the changes feed, advances its cursor, rescans the authorized folder, tombstones removed files, and renews channels nearing expiration.
7. `Sync now` provides explicit recovery when a notification is delayed.

## Google Cloud configuration

Enable APIs:

```bash
gcloud services enable drive.googleapis.com picker.googleapis.com cloudscheduler.googleapis.com \
  --project="gen-lang-client-0812085032"
```

In **Google Auth Platform**, add this OAuth redirect URI (and later add the equivalent `busios.app` URI):

```text
https://busios-ai-w2pzlhwnxa-uc.a.run.app/integrations/google/drive/callback
```

Create a Google Maps/Workspace API key for Picker, restrict it to the BusiOS HTTPS origins, and restrict API usage to Google Picker API. Store it and a random renewal secret:

```bash
gcloud secrets create busios-google-picker-api-key --replication-policy=automatic --project="gen-lang-client-0812085032"
read -rsp 'Google Picker API key: ' VALUE; printf %s "$VALUE" | gcloud secrets versions add busios-google-picker-api-key --data-file=- --project="gen-lang-client-0812085032"; unset VALUE

gcloud secrets create busios-knowledge-sync-secret --replication-policy=automatic --project="gen-lang-client-0812085032"
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add busios-knowledge-sync-secret --data-file=- --project="gen-lang-client-0812085032"
```

Grant the runtime service account access if project-wide secret accessor was not already configured:

```bash
for secret in busios-google-picker-api-key busios-knowledge-sync-secret; do
  gcloud secrets add-iam-policy-binding "$secret" --project="gen-lang-client-0812085032" \
    --member="serviceAccount:busios-runtime@gen-lang-client-0812085032.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

Apply `supabase/migrations/010_live_knowledge_drive.sql` before deployment.

## Notification renewal

Drive notification channels expire. Create a daily Cloud Scheduler call after deployment:

```bash
SYNC_VALUE="$(gcloud secrets versions access latest --secret=busios-knowledge-sync-secret --project=gen-lang-client-0812085032)"
gcloud scheduler jobs create http busios-renew-drive-channels \
  --project=gen-lang-client-0812085032 --location=us-central1 \
  --schedule="17 3 * * *" --time-zone="America/Chicago" --http-method=POST \
  --uri="https://busios-ai-w2pzlhwnxa-uc.a.run.app/internal/knowledge/renew-channels" \
  --headers="X-BusiOS-Sync-Secret=${SYNC_VALUE}"
unset SYNC_VALUE
```

## Agent policies and citations

Finance-named files default to Diego and Lola; staff/team files to Diego and Enrique; brand/marketing files to Diego, Miguel, Julio, and Maria; sales/customer files to Diego, Zulma, Marisol, and Maria. General approved files are available to all registered agents. Future portal policy editing can override these defaults.

Retrieval always requires `business_id` and a registered agent. Results include file ID, name, URL, version, and modified time. Retrieved content is explicitly labeled untrusted data so document text cannot override agent guardrails or approval requirements.

Disconnect revokes the Google refresh token and disables synchronization. Indexed versions remain for audit; they are not returned after source deletion or quarantine.
