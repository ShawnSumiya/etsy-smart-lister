-- License security migration.
-- Does not delete rows or clear the legacy plaintext `key` column.
-- Apply manually after review. Do not run this from the application.

create extension if not exists pgcrypto with schema extensions;

alter table public.license_keys
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists key_hash text,
  add column if not exists buyer_id text,
  add column if not exists valid_from timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists rate_window_start timestamptz,
  add column if not exists rate_count integer not null default 0,
  add column if not exists created_at timestamptz default now();

update public.license_keys
set id = gen_random_uuid()
where id is null;

alter table public.license_keys
  alter column id set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'license_keys'
      and column_name = 'key'
      and is_nullable = 'NO'
  ) then
    execute 'alter table public.license_keys alter column key drop not null';
  end if;
end $$;

do $$
declare
  pk_name text;
  pk_cols text;
begin
  select tc.constraint_name,
         string_agg(kcu.column_name, ',' order by kcu.ordinal_position)
    into pk_name, pk_cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
   and tc.table_name = kcu.table_name
  where tc.table_schema = 'public'
    and tc.table_name = 'license_keys'
    and tc.constraint_type = 'PRIMARY KEY'
  group by tc.constraint_name;

  if pk_name is null then
    execute 'alter table public.license_keys add primary key (id)';
  elsif pk_cols = 'key' then
    execute format('alter table public.license_keys drop constraint %I', pk_name);
    execute 'alter table public.license_keys add primary key (id)';
  end if;
end $$;

-- Hash matches Node.js crypto.createHash("sha256").update(key, "utf8").digest("hex").
-- Existing plaintext values are left in place.
update public.license_keys
set key_hash = encode(extensions.digest(convert_to(key, 'UTF8'), 'sha256'), 'hex')
where key is not null
  and btrim(key) <> ''
  and (key_hash is null or key_hash = '');

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'license_keys'
      and column_name = 'created_at'
  ) then
    execute $sql$
      update public.license_keys
      set valid_from = coalesce(valid_from, created_at, now())
      where valid_from is null
    $sql$;
  else
    update public.license_keys
    set valid_from = coalesce(valid_from, now())
    where valid_from is null;
  end if;
end $$;

create unique index if not exists license_keys_key_hash_uidx
  on public.license_keys (key_hash);

create index if not exists license_keys_buyer_id_idx
  on public.license_keys (buyer_id);

alter table public.license_keys enable row level security;
alter table public.license_keys force row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'license_keys'
  loop
    execute format('drop policy if exists %I on public.license_keys', policy_name);
  end loop;
end $$;

revoke all on table public.license_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.license_keys to service_role;

comment on column public.license_keys.key is
  'Legacy plaintext. Keep existing values. New licenses must store NULL here.';
comment on column public.license_keys.key_hash is
  'SHA-256 hex of the license key. This is the only key material stored for new licenses.';
comment on column public.license_keys.buyer_id is
  'Buyer identifier such as a Coconala transaction id.';
