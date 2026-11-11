-- Anonymous public-recetario usage; private aggregates require an explicitly authorized administrator.
-- Apply after the public catalogue migration. No private recipes, notes, email or IP fields.
begin;
create table if not exists public.blossom_analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.blossom_usage_visits (
  session_id uuid primary key,
  visitor_id uuid not null,
  channel text not null check (channel in ('instagram','direct','other')),
  created_at timestamptz not null default now()
);
create index if not exists blossom_usage_visits_date on public.blossom_usage_visits(created_at);
create table if not exists public.blossom_usage_events (
  session_id uuid not null references public.blossom_usage_visits(session_id) on delete cascade,
  event_kind text not null check (event_kind in ('section','recipe','prepare','copy')),
  target text not null check (length(target) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key(session_id,event_kind,target)
);
alter table public.blossom_analytics_admins enable row level security;
alter table public.blossom_usage_visits enable row level security;
alter table public.blossom_usage_events enable row level security;
revoke all on public.blossom_analytics_admins, public.blossom_usage_visits, public.blossom_usage_events from public, anon, authenticated;

create or replace function public.blossom_record_usage(session_id uuid, visitor_id uuid, event_kind text, target text default '', channel text default 'direct')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare visit public.blossom_usage_visits%rowtype;
begin
  if session_id is null or visitor_id is null or event_kind is null or
     event_kind not in ('visit','section','recipe','prepare','copy') or
     target is null or length(target) > 64 or channel is null or channel not in ('instagram','direct','other') then
    raise exception 'Invalid usage event' using errcode = '22023';
  end if;
  if (event_kind = 'visit' and target <> '') or
     (event_kind = 'section' and target not in ('recipes','preparation','extraction','water')) then
    raise exception 'Invalid usage target' using errcode = '22023';
  end if;
  if event_kind in ('recipe','prepare','copy') and target <> 'reference-bourbon-lavado' and not exists (
    select 1 from public.blossom_publications p join public.blossom_publishers a on a.user_id = p.owner_id
    where p.published and p.public_id::text = target
  ) then
    raise exception 'Only public recipes can be counted' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(session_id::text, 1));
  select * into visit from public.blossom_usage_visits v where v.session_id = blossom_record_usage.session_id;
  if found then
    if visit.visitor_id <> visitor_id or visit.created_at < now() - interval '30 minutes' then
      return jsonb_build_object('recorded', false);
    end if;
  else
    -- Indexed retention, performed only when a new visit arrives; cascading deletes remove its events.
    delete from public.blossom_usage_visits where created_at < now() - interval '60 days';
    insert into public.blossom_usage_visits(session_id,visitor_id,channel) values(session_id,visitor_id,channel);
  end if;
  if event_kind <> 'visit' then
    -- Bound distinct event targets per visit. Retries and repeated clicks remain idempotent.
    if (select count(*) from public.blossom_usage_events e where e.session_id = blossom_record_usage.session_id) >= 200 then
      return jsonb_build_object('recorded', false);
    end if;
    insert into public.blossom_usage_events(session_id,event_kind,target) values(session_id,event_kind,target)
      on conflict do nothing;
  end if;
  return jsonb_build_object('recorded', true);
end;
$$;

create or replace function public.blossom_usage_summary(period_days integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid(); since timestamptz; until_time timestamptz := now();
begin
  if account is null or not exists(select 1 from public.blossom_analytics_admins where user_id=account) or
     not exists(select 1 from public.blossom_publishers where user_id=account) then
    raise exception 'Statistics administrator access required' using errcode = '42501';
  end if;
  if period_days is null or period_days not in (7,30) then
    raise exception 'Choose 7 or 30 days' using errcode = '22023';
  end if;
  since := (date_trunc('day', until_time at time zone 'UTC') - (period_days - 1) * interval '1 day') at time zone 'UTC';
  delete from public.blossom_usage_visits where created_at < now() - interval '60 days';
  return jsonb_build_object(
    'days',period_days, 'since',since, 'until',until_time,
    'visits',(select count(*) from public.blossom_usage_visits where created_at >= since),
    'visitors',(select count(distinct visitor_id) from public.blossom_usage_visits where created_at >= since),
    'preparations',(select count(*) from public.blossom_usage_events where event_kind='prepare' and created_at >= since),
    'copies',(select count(*) from public.blossom_usage_events where event_kind='copy' and created_at >= since),
    'daily',(select coalesce(jsonb_agg(jsonb_build_object('date',to_char(d,'YYYY-MM-DD'),'visits',(select count(*) from public.blossom_usage_visits v where v.created_at >= d and v.created_at < d + interval '1 day')) order by d),'[]'::jsonb)
      from generate_series(since, (date_trunc('day',until_time at time zone 'UTC')) at time zone 'UTC', interval '1 day') d),
    'recipes',(select coalesce(jsonb_agg(jsonb_build_object('id',t.target,'name',case when t.target='reference-bourbon-lavado' then 'Bourbon Lavado · Baseline (referencia)' else coalesce(p.recipe->>'name','Receta retirada') end,
       'views',t.views,'preparations',t.preparations,'copies',t.copies) order by t.views desc,t.preparations desc,t.target),'[]'::jsonb) from (
      select target,count(*) filter(where event_kind='recipe') as views,count(*) filter(where event_kind='prepare') as preparations,count(*) filter(where event_kind='copy') as copies
      from public.blossom_usage_events where event_kind in ('recipe','prepare','copy') and created_at >= since group by target
    ) t left join public.blossom_publications p on p.public_id::text=t.target
    where t.target='reference-bourbon-lavado' or p.owner_id=account),
    'sections',(select coalesce(jsonb_agg(jsonb_build_object('name',target,'visits',n) order by n desc,target),'[]'::jsonb) from (
      select target,count(*) n from public.blossom_usage_events where event_kind='section' and created_at >= since group by target) t),
    'channels',(select coalesce(jsonb_agg(jsonb_build_object('name',channel,'visits',n) order by n desc,channel),'[]'::jsonb) from (
      select channel,count(*) n from public.blossom_usage_visits where created_at >= since group by channel) t)
  );
end;
$$;
revoke all on function public.blossom_record_usage(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.blossom_usage_summary(integer) from public,anon,authenticated;
grant execute on function public.blossom_record_usage(uuid,uuid,text,text,text) to anon;
grant execute on function public.blossom_usage_summary(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
