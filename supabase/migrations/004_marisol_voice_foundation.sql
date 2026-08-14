create table if not exists voice_numbers (
  phone_number text primary key,
  business_id uuid not null,
  twilio_number_sid text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists voice_agent_settings (
  business_id uuid primary key,
  business_name text not null,
  language text not null default 'en' check (language in ('en', 'es', 'pt')),
  greeting text not null,
  fallback_message text not null,
  transfer_number text,
  faqs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists call_sessions (
  call_sid text primary key,
  business_id uuid not null,
  from_number text not null,
  to_number text not null,
  language text not null check (language in ('en', 'es', 'pt')),
  status text not null check (status in ('initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled')),
  transcript jsonb not null default '[]'::jsonb,
  summary jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists call_actions (
  id uuid primary key default gen_random_uuid(),
  call_sid text not null references call_sessions(call_sid) on delete cascade,
  business_id uuid not null,
  action_type text not null check (action_type in ('faq_answered', 'message_captured', 'appointment_simulated', 'human_transfer', 'fallback')),
  payload jsonb not null default '{}'::jsonb,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists voice_numbers_business_idx on voice_numbers (business_id);
create index if not exists call_sessions_business_time_idx on call_sessions (business_id, started_at desc);
create index if not exists call_actions_call_idx on call_actions (call_sid, created_at);

alter table voice_numbers enable row level security;
alter table voice_agent_settings enable row level security;
alter table call_sessions enable row level security;
alter table call_actions enable row level security;

comment on table voice_numbers is 'Server-only mapping from each Twilio number to one BusiOS tenant.';
comment on table call_sessions is 'Tenant-scoped call lifecycle, transcript, and Diego summary.';
comment on table call_actions is 'Auditable Marisol actions; verified=false means simulated or not confirmed by an external adapter.';
