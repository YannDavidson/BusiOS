alter table businesses
  add column if not exists industry text,
  add column if not exists timezone text not null default 'America/Puerto_Rico',
  add column if not exists locale text not null default 'en',
  add column if not exists onboarding_status text not null default 'started'
    check (onboarding_status in ('started', 'configured', 'live', 'paused'));

create table if not exists agent_configurations (
  business_id uuid primary key references businesses(id) on delete cascade,
  config jsonb not null default '{"enabled":["DIEGO","MARISOL","MIGUEL","ZULMA","ENRIQUE","LOLA","JULIO","MARIA"]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table agent_configurations enable row level security;

create or replace function create_owned_business(owner_user_id uuid, business_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_business_id uuid;
begin
  if owner_user_id is null or length(trim(business_name)) < 2 or length(trim(business_name)) > 120 then
    raise exception 'Invalid owner or business name';
  end if;
  insert into businesses (name) values (trim(business_name)) returning id into new_business_id;
  insert into business_memberships (business_id, user_id, role) values (new_business_id, owner_user_id, 'owner');
  insert into billing_accounts (business_id, plan_code, status) values (new_business_id, 'pilot', 'active') on conflict (business_id) do nothing;
  insert into agent_configurations (business_id) values (new_business_id);
  return new_business_id;
end;
$$;

revoke all on function create_owned_business(uuid, text) from public, anon, authenticated;
grant execute on function create_owned_business(uuid, text) to service_role;

comment on table agent_configurations is 'Tenant-owned enablement and future policy configuration for the central BusiOS agent registry.';
comment on function create_owned_business(uuid, text) is 'Server-only atomic tenant, owner membership, pilot billing, and agent configuration provisioning.';
