-- Extend public recipe copies with explicit valve states and step instructions.
-- Requires 202611110001_public_catalogue.sql; preserves existing data and permissions.
begin;
create or replace function public.blossom_project_pour_steps(source jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare item jsonb; state text; instruction text; result jsonb := '[]'::jsonb;
begin
  if source -> 'pourSteps' is null or source -> 'pourSteps' = 'null'::jsonb then return null; end if;
  if jsonb_typeof(source -> 'pourSteps') is distinct from 'array' or
     jsonb_typeof(source -> 'pours') is distinct from 'array' then
    raise exception 'Invalid pour instructions' using errcode = '22023';
  end if;
  if jsonb_array_length(source -> 'pourSteps') <> jsonb_array_length(source -> 'pours') or
     jsonb_array_length(source -> 'pourSteps') not between 1 and 50 then
    raise exception 'Pour instructions must match the plan' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(source -> 'pourSteps') loop
    if jsonb_typeof(item) is distinct from 'object' or
       (item -> 'valve' is not null and item -> 'valve' <> 'null'::jsonb and jsonb_typeof(item -> 'valve') <> 'string') or
       (item -> 'note' is not null and item -> 'note' <> 'null'::jsonb and jsonb_typeof(item -> 'note') <> 'string') then
      raise exception 'Invalid pour instruction fields' using errcode = '22023';
    end if;
    state := coalesce(item ->> 'valve', 'unknown');
    instruction := coalesce(item ->> 'note', '');
    if state not in ('unknown', 'open', 'closed', 'none') or length(instruction) > 500 then
      raise exception 'Invalid valve state or instruction length' using errcode = '22023';
    end if;
    -- No other keys from private step objects may enter the public projection.
    result := result || jsonb_build_array(jsonb_build_object('valve', state, 'note', instruction));
  end loop;
  return result;
end;
$$;
revoke all on function public.blossom_project_pour_steps(jsonb) from public, anon, authenticated;

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
  if source -> 'pourSteps' is not null and source -> 'pourSteps' <> 'null'::jsonb then
    body := body || jsonb_build_object('pourSteps', public.blossom_project_pour_steps(source));
  end if;
  body := body || jsonb_build_object('id', public_key::text);
  insert into public.blossom_publications(owner_id, source_id, public_id, recipe, published)
    values (account, recipe_id, public_key, body, true)
    on conflict (owner_id, source_id) do update set recipe = excluded.recipe, published = true,
      revision = blossom_publications.revision + 1, updated_at = now()
    returning * into existing;
  return jsonb_build_object('source_id', existing.source_id, 'public_id', existing.public_id,
    'published', true, 'revision', existing.revision, 'pour_steps', true);
end;
$$;

create or replace function public.blossom_catalogue_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid();
begin
  if account is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.blossom_publishers where user_id = account) then
    return jsonb_build_object('features', jsonb_build_object('pour_steps', true), 'publisher', false, 'entries', '[]'::jsonb);
  end if;
  return jsonb_build_object('features', jsonb_build_object('pour_steps', true), 'publisher', true, 'entries', (
    select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'public_id', public_id,
      'published', published, 'revision', revision) order by source_id), '[]'::jsonb)
    from public.blossom_publications where owner_id = account));
end;
$$;

revoke all on function public.blossom_catalogue_status() from public, anon, authenticated;
revoke all on function public.blossom_publish_recipe(text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.blossom_catalogue_status() to authenticated;
grant execute on function public.blossom_publish_recipe(text,jsonb,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
