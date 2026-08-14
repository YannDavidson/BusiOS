alter table voice_agent_settings
  add column if not exists realtime_enabled boolean not null default false,
  add column if not exists live_voice text not null default 'Kore',
  add column if not exists max_duration_seconds integer not null default 600 check (max_duration_seconds between 30 and 900),
  add column if not exists max_turns integer not null default 30 check (max_turns between 1 and 100),
  add column if not exists max_audio_seconds integer not null default 900 check (max_audio_seconds between 30 and 1800),
  add column if not exists max_latency_ms integer not null default 750 check (max_latency_ms between 250 and 2000);

create table if not exists realtime_voice_events (
  id uuid primary key default gen_random_uuid(),
  call_sid text not null references call_sessions(call_sid) on delete cascade,
  business_id uuid not null,
  event_type text not null check (event_type in ('connected', 'reconnected', 'interrupted', 'latency_drop', 'limit_reached', 'upstream_error', 'closed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists realtime_voice_events_call_idx on realtime_voice_events (call_sid, created_at);
alter table realtime_voice_events enable row level security;

comment on table realtime_voice_events is 'Operational events and bounded usage metrics for Twilio-to-Gemini realtime sessions.';
