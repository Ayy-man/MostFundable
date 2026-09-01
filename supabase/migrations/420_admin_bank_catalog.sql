-- Platform-admin Bank Vault catalog controls.
--
-- The nightly VAULT import remains the owner of public.banks_cache. Admin
-- edits live in a separate, one-row-per-bank/source content overlay, while
-- publication state lives in its own status table. That separation means an
-- archive never snapshots VAULT prose and a later provider upsert remains
-- visible unless an admin deliberately edited the content. A manually-created
-- bank also gets a cache row because
-- applications.bank_ref has referenced that catalog since migration 383.

alter table public.banks_cache
  drop constraint banks_cache_source_check,
  add constraint banks_cache_source_check
    check (source in ('vault', 'fixture', 'backfill', 'manual'));

create function private.bank_catalog_surface_text_valid(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text !~* E'(^|\\n)[[:space:]]*([-*+][[:space:]]|[0-9]+[.)][[:space:]])|\\*\\*|__|`|\\[[^]]+\\]\\([^)]+\\)|HowToCredit'
$$;

create function private.bank_catalog_payload_valid(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  item_key text;
  keys text[];
  product text;
  product_seen text[] := array[]::text[];
  question_seen text[] := array[]::text[];
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  select pg_catalog.array_agg(key order by key collate "C")
  into keys
  from pg_catalog.jsonb_object_keys(p_payload) as key;
  if keys is distinct from array[
    'application_questions',
    'bureau_pulls',
    'channel_type',
    'channel_value',
    'checking_deposit_cents',
    'checking_required',
    'checking_seasoning',
    'name',
    'products',
    'qualification_summary',
    'rel_manager',
    'rel_manager_tip',
    'source_updated_at'
  ]::text[] then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string'
    or pg_catalog.length(p_payload ->> 'name') not between 1 and 200
    or p_payload ->> 'name' <> pg_catalog.btrim(p_payload ->> 'name')
    or not private.bank_catalog_surface_text_valid(p_payload ->> 'name') then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'products') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload -> 'products') > 50 then
    return false;
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'products') as value
  loop
    if pg_catalog.jsonb_typeof(item) <> 'string' then return false; end if;
    product := item #>> '{}';
    if pg_catalog.length(product) not between 1 and 120
      or product <> pg_catalog.btrim(product)
      or not private.bank_catalog_surface_text_valid(product)
      or product = any(product_seen) then
      return false;
    end if;
    product_seen := product_seen || product;
  end loop;

  foreach item_key in array array[
    'bureau_pulls', 'checking_seasoning', 'qualification_summary', 'rel_manager_tip'
  ]::text[]
  loop
    if p_payload -> item_key <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_payload -> item_key) <> 'string' then
      return false;
    end if;
    if p_payload -> item_key <> 'null'::jsonb
      and (
        pg_catalog.length(p_payload ->> item_key) < 1
        or p_payload ->> item_key <> pg_catalog.btrim(p_payload ->> item_key)
        or not private.bank_catalog_surface_text_valid(p_payload ->> item_key)
      ) then
      return false;
    end if;
  end loop;
  if pg_catalog.length(coalesce(p_payload ->> 'bureau_pulls', '')) > 200
    or pg_catalog.length(coalesce(p_payload ->> 'checking_seasoning', '')) > 200
    or pg_catalog.length(coalesce(p_payload ->> 'qualification_summary', '')) > 500
    or pg_catalog.length(coalesce(p_payload ->> 'rel_manager_tip', '')) > 240 then
    return false;
  end if;

  if p_payload -> 'channel_type' = 'null'::jsonb then
    if p_payload -> 'channel_value' <> 'null'::jsonb then return false; end if;
  elsif pg_catalog.jsonb_typeof(p_payload -> 'channel_type') <> 'string'
    or p_payload ->> 'channel_type' not in ('online', 'phone', 'in-person') then
    return false;
  elsif p_payload ->> 'channel_type' = 'in-person' then
    if p_payload -> 'channel_value' <> 'null'::jsonb then return false; end if;
  elsif pg_catalog.jsonb_typeof(p_payload -> 'channel_value') <> 'string'
    or pg_catalog.length(p_payload ->> 'channel_value') not between 1 and 500
    or p_payload ->> 'channel_value' <> pg_catalog.btrim(p_payload ->> 'channel_value')
    or not private.bank_catalog_surface_text_valid(p_payload ->> 'channel_value') then
    return false;
  end if;
  if p_payload ->> 'channel_type' = 'online'
    and p_payload ->> 'channel_value' !~* '^https://' then
    return false;
  end if;
  if p_payload ->> 'channel_type' = 'phone'
    and p_payload ->> 'channel_value' !~ '^\+?[0-9][0-9 ().-]{5,}$' then
    return false;
  end if;

  foreach item_key in array array['checking_required', 'rel_manager']::text[]
  loop
    if p_payload -> item_key <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_payload -> item_key) <> 'boolean' then
      return false;
    end if;
  end loop;

  if p_payload -> 'checking_deposit_cents' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_payload -> 'checking_deposit_cents') <> 'number'
      or (p_payload ->> 'checking_deposit_cents')::numeric < 0
      or (p_payload ->> 'checking_deposit_cents')::numeric <> pg_catalog.trunc((p_payload ->> 'checking_deposit_cents')::numeric)
      or (p_payload ->> 'checking_deposit_cents')::numeric > 2147483647 then
      return false;
    end if;
  end if;

  if not private.bank_application_questions_valid(p_payload -> 'application_questions')
    or pg_catalog.jsonb_array_length(p_payload -> 'application_questions') > 50 then
    return false;
  end if;
  if (
    select pg_catalog.jsonb_agg(question order by ordinality)
    from pg_catalog.jsonb_array_elements(p_payload -> 'application_questions')
      with ordinality as entry(question, ordinality)
    where ordinality <= 4
  ) is distinct from '[
    {"id":"projected-revenue","label":"Projected revenue","responseBasis":"Use the business''s own current revenue projection and supporting records."},
    {"id":"projected-personal-income","label":"Projected personal income","responseBasis":"Use the applicant''s own current income projection and supporting records."},
    {"id":"projected-monthly-spend","label":"Projected monthly spend","responseBasis":"Use the business''s own current operating-budget projection."},
    {"id":"projected-employees","label":"Projected # employees","responseBasis":"Use the business''s own current staffing projection."}
  ]'::jsonb then
    return false;
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'application_questions') as value
  loop
    item_key := item ->> 'id';
    if item_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
      or item_key = any(question_seen)
      or pg_catalog.length(item ->> 'label') not between 1 and 200
      or item ->> 'label' <> pg_catalog.btrim(item ->> 'label')
      or not private.bank_catalog_surface_text_valid(item ->> 'label')
      or pg_catalog.length(item ->> 'responseBasis') not between 1 and 500
      or item ->> 'responseBasis' <> pg_catalog.btrim(item ->> 'responseBasis')
      or not private.bank_catalog_surface_text_valid(item ->> 'responseBasis') then
      return false;
    end if;
    question_seen := question_seen || item_key;
  end loop;

  if p_payload -> 'source_updated_at' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(p_payload -> 'source_updated_at') <> 'string'
      or p_payload ->> 'source_updated_at' !~ '^\d{4}-\d{2}-\d{2}$'
      or ((p_payload ->> 'source_updated_at')::date)::text <> p_payload ->> 'source_updated_at' then
      return false;
    end if;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

create table public.bank_catalog_overrides (
  id uuid primary key,
  bank_ref text not null references public.banks_cache(bank_ref) on update restrict on delete restrict,
  source text not null default 'platform_admin',
  payload jsonb not null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint bank_catalog_overrides_bank_source_unique unique (bank_ref, source),
  constraint bank_catalog_overrides_source_check check (source = 'platform_admin'),
  constraint bank_catalog_overrides_payload_check check (private.bank_catalog_payload_valid(payload))
);

comment on table public.bank_catalog_overrides is
  'Platform-admin content corrections over banks_cache. Publication state is '
  'kept in bank_catalog_status_overrides so archive/reactivate never snapshots '
  'provider content. No direct write grant exists.';

create table public.bank_catalog_status_overrides (
  id uuid primary key,
  bank_ref text not null unique references public.banks_cache(bank_ref) on update restrict on delete restrict,
  is_active boolean not null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

comment on table public.bank_catalog_status_overrides is
  'Status-only platform-admin publication decisions. No lender content is '
  'stored here, so synced VAULT changes continue to surface after lifecycle actions.';

alter table public.bank_catalog_overrides enable row level security;
alter table public.bank_catalog_overrides force row level security;
alter table public.bank_catalog_status_overrides enable row level security;
alter table public.bank_catalog_status_overrides force row level security;

revoke all on table public.bank_catalog_overrides from public, anon, authenticated, service_role;
revoke all on table public.bank_catalog_status_overrides from public, anon, authenticated, service_role;
grant select on table public.bank_catalog_overrides to service_role;
grant select on table public.bank_catalog_status_overrides to service_role;

-- These three tables become erasure-boundary members once the governed admin
-- writers below exist. Revoked grants are insufficient against a future
-- SECURITY DEFINER path, so carry the catalog-wide ALWAYS statement guard.
create trigger banks_cache_no_truncate
before truncate on public.banks_cache
for each statement execute function public.append_only_guard();
alter table public.banks_cache enable always trigger banks_cache_no_truncate;

create trigger bank_catalog_overrides_no_truncate
before truncate on public.bank_catalog_overrides
for each statement execute function public.append_only_guard();
alter table public.bank_catalog_overrides
  enable always trigger bank_catalog_overrides_no_truncate;

create trigger bank_catalog_status_overrides_no_truncate
before truncate on public.bank_catalog_status_overrides
for each statement execute function public.append_only_guard();
alter table public.bank_catalog_status_overrides
  enable always trigger bank_catalog_status_overrides_no_truncate;

create function private.bank_catalog_effective_active(p_bank_ref text, p_source_active boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select status.is_active
      from public.bank_catalog_status_overrides as status
      where status.bank_ref = p_bank_ref
    ),
    p_source_active
  )
$$;

create function private.bank_catalog_content_override(p_bank_ref text)
returns table(payload jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select manual.payload, manual.updated_at
  from public.bank_catalog_overrides as manual
  join public.banks_cache as cache on cache.bank_ref = manual.bank_ref
  where manual.bank_ref = p_bank_ref
    and manual.source = 'platform_admin'
    and private.bank_catalog_effective_active(cache.bank_ref, cache.is_active)
    and (
      private.auth_app_role() in (
        'operator_member'::public.app_role,
        'platform_admin'::public.app_role
      )
      or (select auth.role()) = 'service_role'
    )
$$;

revoke all on function private.bank_catalog_payload_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.bank_catalog_surface_text_valid(text) from public, anon, authenticated, service_role;
revoke all on function private.bank_catalog_effective_active(text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.bank_catalog_content_override(text) from public, anon, authenticated, service_role;
grant execute on function private.bank_catalog_effective_active(text, boolean) to authenticated, service_role;
grant execute on function private.bank_catalog_content_override(text) to authenticated, service_role;

drop policy if exists banks_cache_select_active on public.banks_cache;
create policy banks_cache_select_active
on public.banks_cache
for select
to authenticated
using (
  private.bank_catalog_effective_active(bank_ref, is_active)
  and private.auth_app_role() in (
    'operator_member'::public.app_role,
    'platform_admin'::public.app_role
  )
);

create or replace view public.bank_read_model
with (security_invoker = true)
as
select
  cache.bank_ref,
  case when manual.payload is null then cache.name else manual.payload ->> 'name' end as name,
  case when manual.payload is null then cache.products else array(
    select pg_catalog.jsonb_array_elements_text(manual.payload -> 'products')
  ) end as products,
  case when manual.payload is null then cache.bureau_pulls else manual.payload ->> 'bureau_pulls' end as bureau_pulls,
  case when manual.payload is null then cache.qualification_summary else manual.payload ->> 'qualification_summary' end as qualification_summary,
  case when manual.payload is null then cache.channel_type else manual.payload ->> 'channel_type' end as channel_type,
  case when manual.payload is null then cache.channel_value else manual.payload ->> 'channel_value' end as channel_value,
  case when manual.payload is null then cache.checking_required else (manual.payload ->> 'checking_required')::boolean end as checking_required,
  case when manual.payload is null then cache.checking_deposit_cents else (manual.payload ->> 'checking_deposit_cents')::integer end as checking_deposit_cents,
  case when manual.payload is null then cache.checking_seasoning else manual.payload ->> 'checking_seasoning' end as checking_seasoning,
  case when manual.payload is null then cache.rel_manager else (manual.payload ->> 'rel_manager')::boolean end as rel_manager,
  case when manual.payload is null then cache.rel_manager_tip else manual.payload ->> 'rel_manager_tip' end as rel_manager_tip,
  case when manual.payload is null then cache.application_questions else manual.payload -> 'application_questions' end as application_questions,
  case when manual.payload is null then cache.source_updated_at else (manual.payload ->> 'source_updated_at')::date end as source_updated_at,
  greatest(cache.synced_at, manual.updated_at) as synced_at,
  stats.heat_level,
  stats.windows,
  stats.last_outcome_at,
  stats.approved_amount_cents_total,
  stats.outcome_count_total,
  stats.computed_at as stats_computed_at
from public.banks_cache as cache
left join lateral private.bank_catalog_content_override(cache.bank_ref) as manual on true
left join public.bank_outcome_stats as stats on stats.bank_ref = cache.bank_ref
where private.bank_catalog_effective_active(cache.bank_ref, cache.is_active);

revoke all on table public.bank_read_model from public, anon, authenticated, service_role;
grant select on table public.bank_read_model to authenticated, service_role;

create view public.admin_bank_catalog_read_model
with (security_invoker = true)
as
select
  pg_catalog.md5('bank_catalog:' || cache.bank_ref)::uuid as catalog_id,
  cache.bank_ref,
  case when manual.id is null then cache.name else manual.payload ->> 'name' end as name,
  case when manual.id is null then cache.products else array(
    select pg_catalog.jsonb_array_elements_text(manual.payload -> 'products')
  ) end as products,
  case when manual.id is null then cache.bureau_pulls else manual.payload ->> 'bureau_pulls' end as bureau_pulls,
  case when manual.id is null then cache.qualification_summary else manual.payload ->> 'qualification_summary' end as qualification_summary,
  case when manual.id is null then cache.channel_type else manual.payload ->> 'channel_type' end as channel_type,
  case when manual.id is null then cache.channel_value else manual.payload ->> 'channel_value' end as channel_value,
  case when manual.id is null then cache.checking_required else (manual.payload ->> 'checking_required')::boolean end as checking_required,
  case when manual.id is null then cache.checking_deposit_cents else (manual.payload ->> 'checking_deposit_cents')::integer end as checking_deposit_cents,
  case when manual.id is null then cache.checking_seasoning else manual.payload ->> 'checking_seasoning' end as checking_seasoning,
  case when manual.id is null then cache.rel_manager else (manual.payload ->> 'rel_manager')::boolean end as rel_manager,
  case when manual.id is null then cache.rel_manager_tip else manual.payload ->> 'rel_manager_tip' end as rel_manager_tip,
  case when manual.id is null then cache.application_questions else manual.payload -> 'application_questions' end as application_questions,
  case when manual.id is null then cache.source_updated_at else (manual.payload ->> 'source_updated_at')::date end as source_updated_at,
  coalesce(status.is_active, cache.is_active) as is_active,
  cache.is_active as source_is_active,
  cache.source,
  (manual.id is not null) as has_override,
  exists (select 1 from public.applications as application where application.bank_ref = cache.bank_ref)
    or exists (select 1 from public.outcomes as outcome where outcome.bank_ref = cache.bank_ref)
    or exists (select 1 from public.bank_outcome_stats as stats where stats.bank_ref = cache.bank_ref)
    as outcome_referenced,
  cache.synced_at,
  greatest(cache.synced_at, manual.updated_at, status.updated_at) as updated_at
from public.banks_cache as cache
left join public.bank_catalog_overrides as manual
  on manual.bank_ref = cache.bank_ref and manual.source = 'platform_admin'
left join public.bank_catalog_status_overrides as status
  on status.bank_ref = cache.bank_ref;

revoke all on table public.admin_bank_catalog_read_model from public, anon, authenticated, service_role;
grant select on table public.admin_bank_catalog_read_model to service_role;

create function public.admin_create_bank_catalog_entry(
  p_actor uuid,
  p_bank_ref text,
  p_payload jsonb
)
returns setof public.admin_bank_catalog_read_model
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.clock_timestamp();
  v_catalog_id uuid;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'BANK_CATALOG_ACTOR_FORBIDDEN';
  end if;
  if p_bank_ref is null or p_bank_ref !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
    or not private.bank_catalog_payload_valid(p_payload) then
    raise exception using errcode = '22023', message = 'BANK_CATALOG_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bank_catalog:' || p_bank_ref, 0));
  if exists (select 1 from public.banks_cache as cache where cache.bank_ref = p_bank_ref) then
    raise exception using errcode = '23505', message = 'BANK_CATALOG_ALREADY_EXISTS';
  end if;

  v_catalog_id := pg_catalog.md5('bank_catalog:' || p_bank_ref)::uuid;
  insert into public.banks_cache (
    bank_ref, name, products, bureau_pulls, qualification_summary,
    channel_type, channel_value, checking_required, checking_deposit_cents,
    checking_seasoning, rel_manager, rel_manager_tip, application_questions,
    source_updated_at, is_active, source, synced_at
  ) values (
    p_bank_ref,
    p_payload ->> 'name',
    array(select pg_catalog.jsonb_array_elements_text(p_payload -> 'products')),
    p_payload ->> 'bureau_pulls',
    p_payload ->> 'qualification_summary',
    p_payload ->> 'channel_type',
    p_payload ->> 'channel_value',
    (p_payload ->> 'checking_required')::boolean,
    (p_payload ->> 'checking_deposit_cents')::integer,
    p_payload ->> 'checking_seasoning',
    (p_payload ->> 'rel_manager')::boolean,
    p_payload ->> 'rel_manager_tip',
    p_payload -> 'application_questions',
    (p_payload ->> 'source_updated_at')::date,
    true,
    'manual',
    v_at
  );

  insert into public.bank_catalog_overrides (
    id, bank_ref, source, payload, created_by, updated_by, created_at, updated_at
  ) values (
    v_catalog_id, p_bank_ref, 'platform_admin', p_payload, p_actor, p_actor, v_at, v_at
  );

  insert into public.audit_log (
    actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_actor, 'bank_catalog.created', 'bank_catalog_entry', v_catalog_id, v_at,
    pg_catalog.jsonb_build_object('source', 'platform_admin', 'to_state', 'active')
  );

  return query select * from public.admin_bank_catalog_read_model as catalog
    where catalog.bank_ref = p_bank_ref;
end;
$$;

create function public.admin_update_bank_catalog_entry(
  p_actor uuid,
  p_bank_ref text,
  p_payload jsonb
)
returns setof public.admin_bank_catalog_read_model
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.clock_timestamp();
  v_catalog_id uuid;
  v_field text;
  v_fields text[] := array[]::text[];
  v_override public.bank_catalog_overrides;
  v_prior public.admin_bank_catalog_read_model;
  v_prior_payload jsonb;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'BANK_CATALOG_ACTOR_FORBIDDEN';
  end if;
  if p_bank_ref is null or p_bank_ref !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
    or not private.bank_catalog_payload_valid(p_payload) then
    raise exception using errcode = '22023', message = 'BANK_CATALOG_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bank_catalog:' || p_bank_ref, 0));
  select catalog.* into v_prior
  from public.admin_bank_catalog_read_model as catalog
  where catalog.bank_ref = p_bank_ref;
  if v_prior.bank_ref is null then
    raise exception using errcode = 'P0002', message = 'BANK_CATALOG_NOT_FOUND';
  end if;

  v_prior_payload := pg_catalog.jsonb_build_object(
    'name', v_prior.name,
    'products', pg_catalog.to_jsonb(v_prior.products),
    'bureau_pulls', v_prior.bureau_pulls,
    'qualification_summary', v_prior.qualification_summary,
    'channel_type', v_prior.channel_type,
    'channel_value', v_prior.channel_value,
    'checking_required', v_prior.checking_required,
    'checking_deposit_cents', v_prior.checking_deposit_cents,
    'checking_seasoning', v_prior.checking_seasoning,
    'rel_manager', v_prior.rel_manager,
    'rel_manager_tip', v_prior.rel_manager_tip,
    'application_questions', v_prior.application_questions,
    'source_updated_at', case when v_prior.source_updated_at is null then null else v_prior.source_updated_at::text end
  );

  select manual.* into v_override
  from public.bank_catalog_overrides as manual
  where manual.bank_ref = p_bank_ref and manual.source = 'platform_admin'
  for update;
  if v_override.id is not null and v_override.payload = p_payload then
    return query select * from public.admin_bank_catalog_read_model as catalog
      where catalog.bank_ref = p_bank_ref;
    return;
  end if;

  for v_field in select key from pg_catalog.jsonb_object_keys(p_payload) as key order by key collate "C"
  loop
    if v_prior_payload -> v_field is distinct from p_payload -> v_field then
      v_fields := pg_catalog.array_append(v_fields, v_field);
    end if;
  end loop;
  if pg_catalog.cardinality(v_fields) = 0 then
    v_fields := array['override'];
  end if;

  v_catalog_id := pg_catalog.md5('bank_catalog:' || p_bank_ref)::uuid;
  insert into public.bank_catalog_overrides as manual (
    id, bank_ref, source, payload, created_by, updated_by, created_at, updated_at
  ) values (
    v_catalog_id, p_bank_ref, 'platform_admin', p_payload, p_actor, p_actor, v_at, v_at
  )
  on conflict (bank_ref, source) do update set
    payload = excluded.payload,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (
    actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_actor, 'bank_catalog.updated', 'bank_catalog_entry', v_catalog_id, v_at,
    pg_catalog.jsonb_build_object('source', 'platform_admin', 'field_names', pg_catalog.to_jsonb(v_fields))
  );

  return query select * from public.admin_bank_catalog_read_model as catalog
    where catalog.bank_ref = p_bank_ref;
end;
$$;

create function public.admin_set_bank_catalog_status(
  p_actor uuid,
  p_bank_ref text,
  p_is_active boolean
)
returns setof public.admin_bank_catalog_read_model
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.clock_timestamp();
  v_catalog_id uuid;
  v_prior public.admin_bank_catalog_read_model;
begin
  if not exists (
    select 1 from public.profiles as actor
    where actor.id = p_actor
      and actor.role = 'platform_admin'
      and actor.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'BANK_CATALOG_ACTOR_FORBIDDEN';
  end if;
  if p_bank_ref is null or p_bank_ref !~ '^[a-z0-9][a-z0-9_-]{0,62}$' or p_is_active is null then
    raise exception using errcode = '22023', message = 'BANK_CATALOG_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bank_catalog:' || p_bank_ref, 0));
  select catalog.* into v_prior
  from public.admin_bank_catalog_read_model as catalog
  where catalog.bank_ref = p_bank_ref;
  if v_prior.bank_ref is null then
    raise exception using errcode = 'P0002', message = 'BANK_CATALOG_NOT_FOUND';
  end if;
  if v_prior.is_active = p_is_active then
    return query select * from public.admin_bank_catalog_read_model as catalog
      where catalog.bank_ref = p_bank_ref;
    return;
  end if;

  v_catalog_id := pg_catalog.md5('bank_catalog:' || p_bank_ref)::uuid;

  insert into public.bank_catalog_status_overrides as status (
    id, bank_ref, is_active, created_by, updated_by, created_at, updated_at
  ) values (
    v_catalog_id, p_bank_ref, p_is_active, p_actor, p_actor, v_at, v_at
  ) on conflict (bank_ref) do update set
    is_active = excluded.is_active,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (
    actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    p_actor,
    case when p_is_active then 'bank_catalog.reactivated' else 'bank_catalog.archived' end,
    'bank_catalog_entry',
    v_catalog_id,
    v_at,
    pg_catalog.jsonb_build_object(
      'source', 'platform_admin',
      'from_state', case when p_is_active then 'archived' else 'active' end,
      'to_state', case when p_is_active then 'active' else 'archived' end
    )
  );

  return query select * from public.admin_bank_catalog_read_model as catalog
    where catalog.bank_ref = p_bank_ref;
end;
$$;

revoke all on function public.admin_create_bank_catalog_entry(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_update_bank_catalog_entry(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_set_bank_catalog_status(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_create_bank_catalog_entry(uuid, text, jsonb) to service_role;
grant execute on function public.admin_update_bank_catalog_entry(uuid, text, jsonb) to service_role;
grant execute on function public.admin_set_bank_catalog_status(uuid, text, boolean) to service_role;

comment on function public.admin_create_bank_catalog_entry(uuid, text, jsonb) is
  'Service-only platform-admin manual lender creation with atomic audit and readback.';
comment on function public.admin_update_bank_catalog_entry(uuid, text, jsonb) is
  'Service-only platform-admin catalog override upsert with atomic audit and readback.';
comment on function public.admin_set_bank_catalog_status(uuid, text, boolean) is
  'Service-only archive/reactivate control; no catalog row or outcome evidence is deleted.';
