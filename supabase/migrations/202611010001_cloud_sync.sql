-- Apply once in the Supabase project's SQL editor. No credentials belong here.
create table if not exists public.blossom_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recipe', 'session')),
  record_id text not null check (length(record_id) between 1 and 512),
  payload jsonb,
  deleted boolean not null default false,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, record_id),
  check ((deleted and payload is null) or
    (not deleted and payload is not null and jsonb_typeof(payload) = 'object' and payload ->> 'id' is not null and payload ->> 'id' = record_id))
);

alter table public.blossom_records enable row level security;
revoke all on public.blossom_records from anon, authenticated;
grant select on public.blossom_records to authenticated;
drop policy if exists "Read own Blossom records" on public.blossom_records;
create policy "Read own Blossom records" on public.blossom_records
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.blossom_sync(changes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  operation jsonb;
  existing public.blossom_records%rowtype;
  present boolean;
  is_deleted boolean;
  expected integer;
  operation_id uuid;
  record_kind text;
  identifier text;
  body jsonb;
  copy_id text;
  copied jsonb;
  conflicts jsonb := '[]'::jsonb;
begin
  if account is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if changes is null or jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 2500 then
    raise exception 'Invalid changes';
  end if;
  -- Serialise requests for this account. Versions never depend on device clocks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account::text, 0));
  for operation in select value from jsonb_array_elements(changes) loop
    record_kind := operation ->> 'kind';
    identifier := operation ->> 'record_id';
    expected := (operation ->> 'base_version')::integer;
    operation_id := (operation ->> 'op_id')::uuid;
    is_deleted := (operation ->> 'deleted')::boolean;
    body := operation -> 'payload';
    if record_kind is null or record_kind not in ('recipe', 'session') or
       identifier is null or length(identifier) not between 1 and 512 or
       expected is null or expected < 0 or operation_id is null or is_deleted is null then
      raise exception 'Invalid operation';
    end if;
    if is_deleted then body := null;
    elsif body is null or jsonb_typeof(body) <> 'object' or
          body ->> 'id' is distinct from identifier or octet_length(body::text) > 131072 or
          (record_kind = 'recipe' and jsonb_typeof(body -> 'name') is distinct from 'string') or
          (record_kind = 'session' and jsonb_typeof(body -> 'coffee') is distinct from 'string') then
      raise exception 'Invalid record';
    end if;
    select * into existing from public.blossom_records
      where user_id = account and kind = record_kind and record_id = identifier;
    present := found;
    if not present and is_deleted then continue; end if;
    -- Replaying an acknowledged write is harmless, including after reconnecting.
    if present and existing.deleted = is_deleted and existing.payload is not distinct from body then continue; end if;
    if not present and expected = 0 then
      insert into public.blossom_records(user_id, kind, record_id, payload, deleted)
        values (account, record_kind, identifier, body, false);
    elsif present and existing.version = expected then
      update public.blossom_records set payload = body, deleted = is_deleted,
        version = version + 1, updated_at = now()
        where user_id = account and kind = record_kind and record_id = identifier;
    elsif not is_deleted then
      -- Preserve both simultaneous edits; the stable operation ID prevents duplicates on retry.
      copy_id := 'conflict-' || operation_id::text;
      copied := jsonb_set(body, '{id}', to_jsonb(copy_id));
      if record_kind = 'recipe' then
        copied := jsonb_set(copied, '{name}', to_jsonb(left(body ->> 'name', 75) || ' · copia conservada'));
      end if;
      insert into public.blossom_records(user_id, kind, record_id, payload, deleted)
        values (account, record_kind, copy_id, copied, false)
        on conflict (user_id, kind, record_id) do nothing;
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('kind', record_kind, 'id', identifier, 'action', 'copied', 'copy_id', copy_id));
    else
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('kind', record_kind, 'id', identifier, 'action', 'remote_kept'));
    end if;
  end loop;
  return jsonb_build_object(
    'records', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'record_id', record_id,
       'payload', payload, 'deleted', deleted, 'version', version) order by kind, record_id), '[]'::jsonb)
       from public.blossom_records where user_id = account),
    'conflicts', conflicts);
end;
$$;

revoke all on function public.blossom_sync(jsonb) from public, anon;
grant execute on function public.blossom_sync(jsonb) to authenticated;
