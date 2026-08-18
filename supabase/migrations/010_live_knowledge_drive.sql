create table if not exists drive_connections (
  business_id uuid primary key references businesses(id) on delete cascade,
  folder_id text not null,
  folder_name text not null,
  credentials_ciphertext text not null,
  change_token text,
  channel_id uuid unique,
  channel_resource_id text,
  channel_token_hash text,
  channel_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','error','disconnected')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_file_id text not null,
  name text not null,
  mime_type text not null,
  modified_time timestamptz not null,
  checksum text not null,
  version integer not null default 1 check (version > 0),
  status text not null check (status in ('indexed','quarantined','unsupported','deleted')),
  warning text,
  allowed_agents text[] not null default array['DIEGO']::text[],
  source_url text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, source_file_id)
);

create table if not exists knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  version integer not null,
  checksum text not null,
  content text not null,
  status text not null,
  warning text,
  recorded_at timestamptz not null default now(),
  unique (document_id, version)
);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  allowed_agents text[] not null,
  unique (document_id, chunk_index)
);

create index if not exists knowledge_chunks_tenant_idx on knowledge_chunks (business_id);
create index if not exists knowledge_chunks_search_idx on knowledge_chunks using gin (search_vector);
create index if not exists knowledge_documents_tenant_status_idx on knowledge_documents (business_id, status);

alter table drive_connections enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_document_versions enable row level security;
alter table knowledge_chunks enable row level security;

create or replace function upsert_drive_knowledge(
  p_business_id uuid, p_file_id text, p_name text, p_mime_type text, p_modified_time timestamptz,
  p_checksum text, p_status text, p_warning text, p_allowed_agents text[], p_source_url text,
  p_content text, p_chunks text[]
) returns void language plpgsql security definer set search_path = public as $$
declare v_document_id uuid; v_version integer; v_existing_checksum text;
begin
  select id, version, checksum into v_document_id, v_version, v_existing_checksum from knowledge_documents where business_id=p_business_id and source_file_id=p_file_id for update;
  if v_document_id is null then
    insert into knowledge_documents (business_id,source_file_id,name,mime_type,modified_time,checksum,version,status,warning,allowed_agents,source_url,content)
    values (p_business_id,p_file_id,p_name,p_mime_type,p_modified_time,p_checksum,1,p_status,p_warning,p_allowed_agents,p_source_url,p_content) returning id,version into v_document_id,v_version;
  elsif v_existing_checksum = p_checksum and (select status from knowledge_documents where id=v_document_id) = p_status then
    update knowledge_documents set name=p_name,modified_time=p_modified_time,source_url=p_source_url,updated_at=now() where id=v_document_id;
    return;
  else
    v_version := v_version + 1;
    update knowledge_documents set name=p_name,mime_type=p_mime_type,modified_time=p_modified_time,checksum=p_checksum,version=v_version,status=p_status,warning=p_warning,allowed_agents=p_allowed_agents,source_url=p_source_url,content=p_content,updated_at=now() where id=v_document_id;
  end if;
  insert into knowledge_document_versions (document_id,business_id,version,checksum,content,status,warning) values (v_document_id,p_business_id,v_version,p_checksum,p_content,p_status,p_warning);
  delete from knowledge_chunks where document_id=v_document_id;
  insert into knowledge_chunks (document_id,business_id,chunk_index,content,allowed_agents)
    select v_document_id,p_business_id,ordinality-1,value,p_allowed_agents from unnest(p_chunks) with ordinality as chunk(value,ordinality);
end $$;

create or replace function search_business_knowledge(p_business_id uuid, p_agent_id text, p_query text, p_limit integer default 5)
returns table(content text, score real, source_file_id text, name text, source_url text, version integer, modified_time timestamptz)
language sql stable security definer set search_path = public as $$
  select kc.content, ts_rank_cd(kc.search_vector, websearch_to_tsquery('simple', p_query))::real,
         kd.source_file_id,kd.name,kd.source_url,kd.version,kd.modified_time
  from knowledge_chunks kc join knowledge_documents kd on kd.id=kc.document_id
  where kc.business_id=p_business_id and kd.business_id=p_business_id and kd.status='indexed'
    and p_agent_id=any(kc.allowed_agents) and kc.search_vector @@ websearch_to_tsquery('simple', p_query)
  order by 2 desc limit least(greatest(p_limit,1),10)
$$;

revoke all on function upsert_drive_knowledge(uuid,text,text,text,timestamptz,text,text,text,text[],text,text,text[]) from public, anon, authenticated;
revoke all on function search_business_knowledge(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function upsert_drive_knowledge(uuid,text,text,text,timestamptz,text,text,text,text[],text,text,text[]) to service_role;
grant execute on function search_business_knowledge(uuid,text,text,integer) to service_role;

comment on table drive_connections is 'One encrypted, tenant-authorized Google Drive knowledge folder connection per business.';
comment on table knowledge_document_versions is 'Immutable source snapshots supporting citations, audit, and rollback.';
comment on table knowledge_chunks is 'Tenant- and agent-scoped searchable Business Brain fragments.';
