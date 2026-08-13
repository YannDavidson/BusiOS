create table if not exists team_runs (
  id uuid primary key,
  business_id uuid not null,
  objective text not null,
  status text not null check (status in ('planned', 'awaiting_approval', 'running', 'completed', 'cancelled', 'failed')),
  language text not null default 'en' check (language in ('en', 'es', 'pt')),
  plan jsonb not null,
  synthesis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_tasks (
  id uuid primary key,
  run_id uuid not null references team_runs(id) on delete cascade,
  business_id uuid not null,
  agent_id text not null check (agent_id in ('MARISOL', 'MIGUEL', 'ZULMA', 'ENRIQUE', 'LOLA', 'JULIO', 'MARIA', 'DIEGO')),
  objective text not null,
  risk text not null check (risk in ('informational', 'reversible', 'consequential', 'restricted')),
  requires_owner_approval boolean not null default true,
  status text not null check (status in ('planned', 'running', 'completed', 'cancelled', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table conversation_states add column if not exists pending_run_id uuid;

create index if not exists team_runs_business_time_idx on team_runs (business_id, created_at desc);
create index if not exists agent_tasks_run_idx on agent_tasks (run_id, created_at);

alter table team_runs enable row level security;
alter table agent_tasks enable row level security;

comment on table team_runs is 'Durable, server-only multi-agent plans and synthesized outcomes.';
comment on table agent_tasks is 'Durable specialist assignments and results. External execution requires verified adapter receipts.';
