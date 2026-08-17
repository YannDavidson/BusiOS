#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0812085032}"
REGION="${REGION:-us-central1}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-YannDavidson/BusiOS}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOY_SA="busios-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="busios-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github"
PROVIDER="busios"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com secretmanager.googleapis.com sts.googleapis.com

gcloud artifacts repositories describe busios --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create busios --repository-format=docker --location="$REGION" --description="BusiOS production images"

for account in busios-deployer busios-runtime; do
  gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$account" --display-name="$account"
done

for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOY_SA}" --role="$role" --condition=None
done

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --condition=None

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPOSITORY}'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPOSITORY}"

for secret in busios-gemini-api-key busios-twilio-account-sid busios-twilio-auth-token busios-supabase-url busios-supabase-service-role-key busios-app-encryption-key busios-google-oauth-client-id busios-google-oauth-client-secret busios-stripe-secret-key busios-stripe-webhook-secret busios-stripe-price-basic busios-stripe-price-growth busios-stripe-price-business; do
  gcloud secrets describe "$secret" >/dev/null 2>&1 || gcloud secrets create "$secret" --replication-policy=automatic
done

printf '\nGitHub repository variables to add:\n'
printf 'GCP_WIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$PROJECT_NUMBER" "$POOL" "$PROVIDER"
printf 'GCP_DEPLOY_SERVICE_ACCOUNT=%s\n' "$DEPLOY_SA"
printf '\nAdd secret values using the commands in docs/CLOUD_RUN.md; do not paste secrets into GitHub or chat.\n'
