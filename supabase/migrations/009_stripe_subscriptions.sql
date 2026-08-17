alter table billing_accounts
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists trial_ends_at timestamptz;

update billing_accounts set trial_ends_at = now() + interval '14 days'
where plan_code = 'pilot' and trial_ends_at is null;

create unique index if not exists billing_stripe_customer_idx
  on billing_accounts (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists billing_stripe_subscription_idx
  on billing_accounts (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table stripe_webhook_events enable row level security;

comment on table stripe_webhook_events is 'Server-only Stripe event idempotency ledger; entitlements are synchronized only from signature-verified webhooks.';
comment on column billing_accounts.plan_code is 'BusiOS entitlement plan: pilot, basic (2 agents), growth (4), business (8), or custom.';
comment on column billing_accounts.trial_ends_at is 'Pilot entitlement expiry; expired pilots fall back to the two-agent limit until checkout succeeds.';

create or replace function create_owned_business(owner_user_id uuid, business_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_business_id uuid;
begin
  if owner_user_id is null or length(trim(business_name)) < 2 or length(trim(business_name)) > 120 then raise exception 'Invalid owner or business name'; end if;
  insert into businesses (name) values (trim(business_name)) returning id into new_business_id;
  insert into business_memberships (business_id, user_id, role) values (new_business_id, owner_user_id, 'owner');
  insert into billing_accounts (business_id, plan_code, status, trial_ends_at) values (new_business_id, 'pilot', 'active', now() + interval '14 days') on conflict (business_id) do nothing;
  insert into agent_configurations (business_id) values (new_business_id);
  return new_business_id;
end $$;
