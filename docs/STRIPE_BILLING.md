# Stripe billing setup

BusiOS uses Stripe-hosted Checkout for subscription purchase and the Stripe Customer Portal for payment changes, invoices, upgrades, and cancellation. Agent entitlements change only after a signature-verified subscription webhook.

| Product | Monthly price | Plan code | Agent allowance |
| --- | ---: | --- | ---: |
| BusiOS Basic | $119 USD | `basic` | 2 (Diego + 1) |
| BusiOS Growth | $169 USD | `growth` | 4 (Diego + 3) |
| BusiOS Business | $299 USD | `business` | 8 |

Create one recurring monthly Stripe Price for each product in Test mode first. Copy each `price_...` ID, not its `prod_...` Product ID.

## Required Google Secret Manager secrets

- `busios-stripe-secret-key`: Stripe secret key (`sk_...`)
- `busios-stripe-webhook-secret`: endpoint signing secret (`whsec_...`)
- `busios-stripe-price-basic`: Basic recurring Price ID
- `busios-stripe-price-growth`: Growth recurring Price ID
- `busios-stripe-price-business`: Business recurring Price ID

Never put secret values in GitHub, SQL, logs, or browser code.

## Activation

1. Apply `supabase/migrations/009_stripe_subscriptions.sql` in the Supabase SQL Editor.
2. In Stripe Workbench, add `https://busios-ai-w2pzlhwnxa-uc.a.run.app/webhooks/stripe`.
3. Subscribe it to `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
4. Save its signing secret as `busios-stripe-webhook-secret`.
5. Enable and configure the Stripe Customer Portal.
6. Deploy, sign in to `/portal/`, choose **View plans**, and finish a Test-mode checkout.
7. Confirm the webhook returns HTTP 200 and `billing_accounts` contains the Stripe customer, subscription, status, and plan.

Pilot workspaces receive all eight agents for 14 days. After expiry, the server enforces a two-agent fallback until a paid subscription is active. Telecom and provider usage is metered separately.
