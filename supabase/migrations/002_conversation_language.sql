alter table conversation_states
  add column if not exists language text not null default 'en'
  check (language in ('en', 'es', 'pt'));
