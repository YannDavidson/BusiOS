create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, provider text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  config jsonb not null default '{}'::jsonb, credentials_ciphertext text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

create table if not exists consent_records (
  id uuid primary key, business_id uuid not null, subject text not null,
  purpose text not null check (purpose in ('service', 'appointment', 'transactional_message', 'callback', 'marketing')),
  channel text not null check (channel in ('voice', 'sms', 'whatsapp', 'email')),
  status text not null check (status in ('granted', 'revoked')), source text not null,
  evidence jsonb not null default '{}'::jsonb, granted_at timestamptz not null, revoked_at timestamptz
);

create table if not exists verified_actions (
  id uuid primary key, business_id uuid not null,
  kind text not null check (kind in ('calendar.create', 'crm.upsert', 'confirmation.send', 'callback.place')),
  status text not null check (status in ('pending_approval', 'approved', 'executing', 'accepted', 'verified', 'failed', 'cancelled')),
  idempotency_key text not null, payload jsonb not null, consent_id uuid references consent_records(id),
  approved_by text, approved_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null,
  unique (business_id, idempotency_key)
);

create table if not exists execution_receipts (
  id uuid primary key, action_id uuid not null unique references verified_actions(id) on delete cascade,
  business_id uuid not null, provider text not null, provider_resource_id text not null unique,
  status text not null check (status in ('accepted', 'verified', 'failed')), verified boolean not null default false,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null, updated_at timestamptz not null
);

create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, external_key text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (business_id, external_key)
);

create table if not exists billing_accounts (
  business_id uuid primary key, plan_code text not null default 'pilot', status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  included_units jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, action_id uuid references verified_actions(id),
  metric text not null, quantity numeric not null check (quantity >= 0), estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  occurred_at timestamptz not null default now()
);

create index if not exists consent_active_idx on consent_records (business_id, subject, purpose, channel, granted_at desc);
create index if not exists actions_business_time_idx on verified_actions (business_id, created_at desc);
create index if not exists usage_business_time_idx on usage_events (business_id, occurred_at desc);

create or replace view business_usage_monthly as
select business_id, date_trunc('month', occurred_at) as month, metric, sum(quantity) as quantity, sum(estimated_cost_micros) as estimated_cost_micros
from usage_events group by business_id, date_trunc('month', occurred_at), metric;

alter table integration_connections enable row level security;
alter table consent_records enable row level security;
alter table verified_actions enable row level security;
alter table execution_receipts enable row level security;
alter table crm_contacts enable row level security;
alter table billing_accounts enable row level security;
alter table usage_events enable row level security;

comment on column integration_connections.credentials_ciphertext is 'AES-256-GCM envelope encrypted with APP_ENCRYPTION_KEY; never store OAuth tokens in config.';
comment on table execution_receipts is 'Provider acceptance is not completion. verified=true only after an immediate verified API result or signed terminal callback.';
comment on view business_usage_monthly is 'Usage and estimated provider cost; this view does not charge the tenant.';
