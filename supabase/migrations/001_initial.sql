create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz not null default now()
);

create table if not exists conversation_states (
  business_id uuid primary key,
  phone text not null unique,
  onboarding_step integer not null default 0 check (onboarding_step between 0 and 10),
  brain jsonb not null default '{}'::jsonb,
  pending_opportunity jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_business_time_idx on audit_events (business_id, created_at desc);

alter table businesses enable row level security;
alter table conversation_states enable row level security;
alter table audit_events enable row level security;

comment on table conversation_states is 'Server-only state accessed with the Supabase service role. Never expose that key to clients.';
