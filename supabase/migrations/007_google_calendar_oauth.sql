create table if not exists business_memberships (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists oauth_authorization_states (
  state_hash text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null,
  verifier_ciphertext text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_memberships_user_idx on business_memberships (user_id, business_id);
create index if not exists oauth_states_expiry_idx on oauth_authorization_states (expires_at) where consumed_at is null;

alter table business_memberships enable row level security;
alter table oauth_authorization_states enable row level security;

comment on table business_memberships is 'Server-verified Supabase users allowed to administer a BusiOS tenant; Calendar changes require owner or admin.';
comment on table oauth_authorization_states is 'Single-use, expiring Google OAuth state. Raw state is never stored; PKCE verifier is AES-256-GCM encrypted.';

create or replace function purge_expired_oauth_authorization_states()
returns bigint language plpgsql security definer set search_path = public as $$
declare deleted_count bigint;
begin
  delete from oauth_authorization_states where expires_at < now() - interval '1 day' or consumed_at < now() - interval '1 day';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function purge_expired_oauth_authorization_states()
  from public, anon, authenticated;

grant execute on function purge_expired_oauth_authorization_states()
  to service_role;
