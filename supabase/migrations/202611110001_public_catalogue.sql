-- Run as the project administrator in Supabase SQL Editor, after cloud_sync.sql.
-- No account is granted publishing access automatically.
begin;

create table if not exists public.blossom_publishers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.blossom_publications (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  public_id uuid not null default gen_random_uuid() unique,
  recipe jsonb,
  published boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, source_id),
  check ((published and recipe is not null and jsonb_typeof(recipe) = 'object') or
         (not published and recipe is null))
);
alter table public.blossom_publishers enable row level security;
alter table public.blossom_publications enable row level security;
revoke all on public.blossom_publishers, public.blossom_publications from public, anon, authenticated;

create or replace function public.blossom_public_catalogue()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(recipe order by updated_at desc, public_id), '[]'::jsonb)
  from public.blossom_publications where published
    and owner_id in (select user_id from public.blossom_publishers);
$$;

create or replace function public.blossom_catalogue_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid();
begin
  if account is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.blossom_publishers where user_id = account) then
    return jsonb_build_object('publisher', false, 'entries', '[]'::jsonb);
  end if;
  return jsonb_build_object('publisher', true, 'entries', (
    select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'public_id', public_id,
      'published', published, 'revision', revision) order by source_id), '[]'::jsonb)
    from public.blossom_publications where owner_id = account));
end;
$$;

create or replace function public.blossom_publish_recipe(recipe_id text, expected_recipe jsonb, expected_revision integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
  source jsonb;
  body jsonb;
  existing public.blossom_publications%rowtype;
  present boolean;
  public_key uuid;
begin
  if account is null or not exists (select 1 from public.blossom_publishers where user_id = account) then
    raise exception 'Publisher access required' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Invalid revision'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account::text, 0));
  select payload into source from public.blossom_records
    where user_id = account and kind = 'recipe' and record_id = recipe_id and not deleted;
  if not found then raise exception 'Save and synchronize this recipe first' using errcode = '40001'; end if;
  if source is distinct from expected_recipe then
    raise exception 'Recipe changed or synchronization is pending' using errcode = '40001';
  end if;
  if jsonb_typeof(source -> 'name') is distinct from 'string' or
     length(btrim(source ->> 'name')) not between 1 and 100 or
     jsonb_typeof(source -> 'coffee') is distinct from 'string' or
     length(btrim(source ->> 'coffee')) not between 1 and 120 or
     jsonb_typeof(source -> 'dose') is distinct from 'number' or
     jsonb_typeof(source -> 'water') is distinct from 'number' or
     jsonb_typeof(source -> 'temp') is distinct from 'number' or
     jsonb_typeof(source -> 'method') is distinct from 'string' then
    raise exception 'Invalid recipe';
  end if;
  if (source ->> 'dose')::numeric <= 0 or (source ->> 'dose')::numeric > 1000 or
     (source ->> 'water')::numeric <= 0 or (source ->> 'water')::numeric > 20000 or
     (source ->> 'temp')::numeric < 0 or (source ->> 'temp')::numeric > 100 then
    raise exception 'Invalid recipe parameters';
  end if;
  select * into existing from public.blossom_publications where owner_id = account and source_id = recipe_id;
  present := found;
  if (present and existing.revision <> expected_revision) or (not present and expected_revision <> 0) then
    raise exception 'Publication changed; refresh before publishing' using errcode = '40001';
  end if;
  public_key := case when present then existing.public_id else gen_random_uuid() end;
  -- This allowlist deliberately excludes notes, sessions, scores, identifiers and account data.
  select jsonb_object_agg(key, value) into body from jsonb_each(source)
    where key in ('name', 'coffee', 'method', 'dose', 'water', 'ratio', 'temp', 'temp2',
      'bloom', 'time', 'grind', 'grinder', 'grindSize', 'grindMicrons',
      'pours', 'pourTimes', 'pourCount', 'bloomWater');
  if jsonb_typeof(source -> 'waterProfile') = 'object' then
    body := body || jsonb_build_object('waterProfile', (
      select jsonb_object_agg(key, value) from jsonb_each(source -> 'waterProfile')
      where key in ('version', 'system', 'base', 'name', 'liters', 'gh', 'alkalinity')));
  end if;
  body := body || jsonb_build_object('id', public_key::text);
  insert into public.blossom_publications(owner_id, source_id, public_id, recipe, published)
    values (account, recipe_id, public_key, body, true)
    on conflict (owner_id, source_id) do update set recipe = excluded.recipe, published = true,
      revision = blossom_publications.revision + 1, updated_at = now()
    returning * into existing;
  return jsonb_build_object('source_id', existing.source_id, 'public_id', existing.public_id,
    'published', true, 'revision', existing.revision);
end;
$$;

create or replace function public.blossom_withdraw_recipe(recipe_id text, expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid(); existing public.blossom_publications%rowtype;
begin
  if account is null or not exists (select 1 from public.blossom_publishers where user_id = account) then
    raise exception 'Publisher access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account::text, 0));
  select * into existing from public.blossom_publications where owner_id = account and source_id = recipe_id;
  if not found or expected_revision is null or existing.revision <> expected_revision then
    raise exception 'Publication changed; refresh before withdrawing' using errcode = '40001';
  end if;
  update public.blossom_publications set recipe = null, published = false,
    revision = revision + 1, updated_at = now() where owner_id = account and source_id = recipe_id
    returning * into existing;
  return jsonb_build_object('source_id', existing.source_id, 'public_id', existing.public_id,
    'published', false, 'revision', existing.revision);
end;
$$;

create or replace function public.blossom_hide_deleted_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.kind = 'recipe' and (TG_OP = 'DELETE' or new.deleted) then
    update public.blossom_publications set recipe = null, published = false,
      revision = revision + 1, updated_at = now()
      where owner_id = old.user_id and source_id = old.record_id and published;
  end if;
  return null;
end;
$$;
drop trigger if exists blossom_withdraw_deleted on public.blossom_records;
create trigger blossom_withdraw_deleted after update or delete on public.blossom_records
  for each row execute function public.blossom_hide_deleted_publication();

revoke all on function public.blossom_public_catalogue() from public, anon, authenticated;
revoke all on function public.blossom_catalogue_status() from public, anon, authenticated;
revoke all on function public.blossom_publish_recipe(text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.blossom_withdraw_recipe(text,integer) from public, anon, authenticated;
revoke all on function public.blossom_hide_deleted_publication() from public, anon, authenticated;
grant execute on function public.blossom_public_catalogue() to anon, authenticated;
grant execute on function public.blossom_catalogue_status() to authenticated;
grant execute on function public.blossom_publish_recipe(text,jsonb,integer) to authenticated;
grant execute on function public.blossom_withdraw_recipe(text,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
