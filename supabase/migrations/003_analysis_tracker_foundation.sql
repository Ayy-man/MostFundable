create type public.analysis_trigger as enum ('scheduled', 'alert', 'force_pull', 'upload');
create type public.checklist_kind as enum ('personal_credit', 'business_setup');
create type public.checklist_state as enum ('todo', 'reported', 'verifying', 'verified');

create function private.derived_features_valid(p_derived jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  account jsonb;
  bureau jsonb;
  current_key text;
  key_set text[];
  numeric_value numeric;
begin
  if p_derived is null or jsonb_typeof(p_derived) <> 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into key_set
  from jsonb_object_keys(p_derived) as key;

  if key_set <> array[
    'accounts',
    'averageAgeMonths',
    'bureausPulled',
    'computedAt',
    'dti',
    'flags',
    'highestRevolvingLimitCents',
    'inquiriesByBureau',
    'negativesCount',
    'openRevolvingCount',
    'overallUtilizationPct',
    'schemaVersion'
  ]::text[] then
    return false;
  end if;

  if jsonb_typeof(p_derived -> 'schemaVersion') <> 'number'
    or (p_derived ->> 'schemaVersion')::numeric <> 1 then
    return false;
  end if;

  if jsonb_typeof(p_derived -> 'bureausPulled') <> 'array' then
    return false;
  end if;

  for bureau in select value from jsonb_array_elements(p_derived -> 'bureausPulled')
  loop
    if jsonb_typeof(bureau) <> 'string'
      or bureau #>> '{}' not in ('EQF', 'EXP', 'TUC') then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'accounts') <> 'array' then
    return false;
  end if;

  for account in select value from jsonb_array_elements(p_derived -> 'accounts')
  loop
    if jsonb_typeof(account) <> 'object' then
      return false;
    end if;

    select array_agg(key order by key)
    into key_set
    from jsonb_object_keys(account) as key;

    if key_set <> array[
      'accountRef',
      'ageMonths',
      'balanceCents',
      'isNegative',
      'isOpen',
      'kind',
      'limitCents',
      'utilizationPct'
    ]::text[] then
      return false;
    end if;

    if jsonb_typeof(account -> 'accountRef') <> 'string'
      or length(account ->> 'accountRef') = 0
      or jsonb_typeof(account -> 'kind') <> 'string'
      or account ->> 'kind' not in ('revolving', 'installment', 'mortgage', 'other')
      or jsonb_typeof(account -> 'balanceCents') <> 'number'
      or jsonb_typeof(account -> 'isOpen') <> 'boolean'
      or jsonb_typeof(account -> 'isNegative') <> 'boolean' then
      return false;
    end if;

    numeric_value := (account ->> 'balanceCents')::numeric;
    if numeric_value < 0 then
      return false;
    end if;

    if account -> 'limitCents' <> 'null'::jsonb then
      if jsonb_typeof(account -> 'limitCents') <> 'number'
        or (account ->> 'limitCents')::numeric < 0 then
        return false;
      end if;
    end if;

    if account -> 'utilizationPct' <> 'null'::jsonb then
      if jsonb_typeof(account -> 'utilizationPct') <> 'number' then
        return false;
      end if;
      numeric_value := (account ->> 'utilizationPct')::numeric;
      if numeric_value < 0 or numeric_value > 100 then
        return false;
      end if;
    end if;

    if account -> 'ageMonths' <> 'null'::jsonb then
      if jsonb_typeof(account -> 'ageMonths') <> 'number'
        or (account ->> 'ageMonths')::numeric < 0 then
        return false;
      end if;
    end if;
  end loop;

  if p_derived -> 'overallUtilizationPct' <> 'null'::jsonb then
    if jsonb_typeof(p_derived -> 'overallUtilizationPct') <> 'number' then
      return false;
    end if;
    numeric_value := (p_derived ->> 'overallUtilizationPct')::numeric;
    if numeric_value < 0 or numeric_value > 100 then
      return false;
    end if;
  end if;

  if jsonb_typeof(p_derived -> 'inquiriesByBureau') <> 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into key_set
  from jsonb_object_keys(p_derived -> 'inquiriesByBureau') as key;

  if key_set <> array['EQF', 'EXP', 'TUC']::text[] then
    return false;
  end if;

  foreach current_key in array array['EQF', 'EXP', 'TUC']::text[]
  loop
    if jsonb_typeof((p_derived -> 'inquiriesByBureau') -> current_key) <> 'number' then
      return false;
    end if;
    numeric_value := ((p_derived -> 'inquiriesByBureau') ->> current_key)::numeric;
    if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
      return false;
    end if;
  end loop;

  foreach current_key in array array['negativesCount', 'openRevolvingCount']::text[]
  loop
    if jsonb_typeof(p_derived -> current_key) <> 'number' then
      return false;
    end if;
    numeric_value := (p_derived ->> current_key)::numeric;
    if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
      return false;
    end if;
  end loop;

  foreach current_key in array array['averageAgeMonths', 'highestRevolvingLimitCents']::text[]
  loop
    if p_derived -> current_key <> 'null'::jsonb then
      if jsonb_typeof(p_derived -> current_key) <> 'number'
        or (p_derived ->> current_key)::numeric < 0 then
        return false;
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'dti') <> 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into key_set
  from jsonb_object_keys(p_derived -> 'dti') as key;

  if key_set <> array[
    'monthlyDebtPaymentsCents',
    'ratioPct',
    'statedMonthlyIncomeCents'
  ]::text[] then
    return false;
  end if;

  if jsonb_typeof((p_derived -> 'dti') -> 'monthlyDebtPaymentsCents') <> 'number'
    or ((p_derived -> 'dti') ->> 'monthlyDebtPaymentsCents')::numeric < 0 then
    return false;
  end if;

  foreach current_key in array array['statedMonthlyIncomeCents', 'ratioPct']::text[]
  loop
    if (p_derived -> 'dti') -> current_key <> 'null'::jsonb then
      if jsonb_typeof((p_derived -> 'dti') -> current_key) <> 'number'
        or ((p_derived -> 'dti') ->> current_key)::numeric < 0 then
        return false;
      end if;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'flags') <> 'object' then
    return false;
  end if;

  select array_agg(key order by key)
  into key_set
  from jsonb_object_keys(p_derived -> 'flags') as key;

  if key_set <> array[
    'averageAgeTwoYearsOrMore',
    'cardWithTenKLimit',
    'fourOrMorePersonalAccountsOpen',
    'noNegativeItemsReported',
    'thinFile',
    'twoOrFewerInquiriesEveryBureau',
    'utilizationUnder30'
  ]::text[] then
    return false;
  end if;

  foreach current_key in array array[
    'averageAgeTwoYearsOrMore',
    'cardWithTenKLimit',
    'fourOrMorePersonalAccountsOpen',
    'noNegativeItemsReported',
    'thinFile',
    'twoOrFewerInquiriesEveryBureau',
    'utilizationUnder30'
  ]::text[]
  loop
    if jsonb_typeof((p_derived -> 'flags') -> current_key) <> 'boolean' then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'computedAt') <> 'string'
    or (p_derived ->> 'computedAt') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create function private.audit_meta_valid(p_meta jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  meta_key text;
  numeric_value numeric;
begin
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    return false;
  end if;

  for meta_key in select key from jsonb_object_keys(p_meta) as key
  loop
    if meta_key not in (
      'count',
      'driver',
      'field_names',
      'from_state',
      'job',
      'reason_code',
      'source',
      'status',
      'to_state',
      'version'
    ) then
      return false;
    end if;

    if meta_key = 'count' then
      if jsonb_typeof(p_meta -> meta_key) <> 'number' then
        return false;
      end if;
      numeric_value := (p_meta ->> meta_key)::numeric;
      if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
        return false;
      end if;
    elsif meta_key = 'field_names' then
      if jsonb_typeof(p_meta -> meta_key) <> 'array'
        or jsonb_array_length(p_meta -> meta_key) > 32 then
        return false;
      end if;
      for item in select value from jsonb_array_elements(p_meta -> meta_key)
      loop
        if jsonb_typeof(item) <> 'string' or length(item #>> '{}') > 64 then
          return false;
        end if;
      end loop;
    elsif jsonb_typeof(p_meta -> meta_key) <> 'string'
      or length(p_meta ->> meta_key) > 128 then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create table public.analysis_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ran_at timestamptz not null default now(),
  trigger public.analysis_trigger not null,
  readiness_score integer not null,
  derived jsonb not null,
  constraint analysis_runs_id_client_unique unique (id, client_id),
  constraint analysis_runs_readiness_range check (readiness_score between 0 and 100),
  constraint analysis_runs_derived_valid check (private.derived_features_valid(derived))
);

create table public.plans (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  analysis_run_id uuid not null unique,
  version integer not null,
  body jsonb not null,
  readiness_score integer not null,
  created_at timestamptz not null default now(),
  constraint plans_version_positive check (version > 0),
  constraint plans_body_object check (jsonb_typeof(body) = 'object'),
  constraint plans_readiness_range check (readiness_score between 0 and 100),
  constraint plans_analysis_run_client_fk
    foreign key (analysis_run_id, client_id)
    references public.analysis_runs(id, client_id)
);

create table public.checklist_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  kind public.checklist_kind not null,
  key text not null,
  title text not null,
  blocking boolean not null default true,
  sort_order integer not null,
  constraint checklist_templates_kind_key_unique unique (kind, key),
  constraint checklist_templates_sort_nonnegative check (sort_order >= 0)
);

create table public.checklist_items (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id),
  parent_item_id uuid,
  title text not null,
  blocking boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint checklist_items_id_client_unique unique (id, client_id),
  constraint checklist_items_client_template_unique unique (client_id, template_id),
  constraint checklist_items_parent_not_self check (parent_item_id is null or parent_item_id <> id),
  constraint checklist_items_sort_nonnegative check (sort_order >= 0),
  constraint checklist_items_parent_client_fk
    foreign key (parent_item_id, client_id)
    references public.checklist_items(id, client_id)
);

create table public.checklist_item_state (
  checklist_item_id uuid primary key,
  client_id uuid not null,
  state public.checklist_state not null default 'todo',
  reported_at timestamptz,
  verifying_at timestamptz,
  verified_at timestamptz,
  verified_by_run_id uuid,
  constraint checklist_item_state_item_client_fk
    foreign key (checklist_item_id, client_id)
    references public.checklist_items(id, client_id) on delete cascade,
  constraint checklist_item_state_run_client_fk
    foreign key (verified_by_run_id, client_id)
    references public.analysis_runs(id, client_id),
  constraint checklist_item_state_shape_check check (
    (
      state = 'todo'
      and reported_at is null
      and verifying_at is null
      and verified_at is null
      and verified_by_run_id is null
    )
    or (
      state = 'reported'
      and reported_at is not null
      and verifying_at is null
      and verified_at is null
      and verified_by_run_id is null
    )
    or (
      state = 'verifying'
      and reported_at is not null
      and verifying_at is not null
      and reported_at <= verifying_at
      and verified_at is null
      and verified_by_run_id is null
    )
    or (
      state = 'verified'
      and reported_at is not null
      and verifying_at is not null
      and verified_at is not null
      and reported_at <= verifying_at
      and verifying_at <= verified_at
      and verified_by_run_id is not null
    )
  )
);

create table public.stage_history (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  from_stage public.client_stage,
  to_stage public.client_stage not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id),
  constraint stage_history_distinct_stage check (from_stage is null or from_stage <> to_stage)
);

create table public.audit_log (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid references public.orgs(id),
  client_id uuid references public.clients(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id),
  action text not null,
  subject_type text not null,
  subject_id uuid not null,
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  constraint audit_log_meta_valid check (private.audit_meta_valid(meta))
);

create index analysis_runs_client_ran_at_idx on public.analysis_runs(client_id, ran_at desc);
create index plans_client_created_at_idx on public.plans(client_id, created_at desc);
create index checklist_templates_kind_idx on public.checklist_templates(kind);
create index checklist_items_client_id_idx on public.checklist_items(client_id);
create index checklist_items_template_id_idx on public.checklist_items(template_id);
create index checklist_items_parent_item_id_idx on public.checklist_items(parent_item_id);
create index checklist_item_state_client_id_idx on public.checklist_item_state(client_id);
create index checklist_item_state_verified_by_run_id_idx
  on public.checklist_item_state(verified_by_run_id);
create index stage_history_client_changed_at_idx
  on public.stage_history(client_id, changed_at desc);
create index stage_history_changed_by_idx on public.stage_history(changed_by);
create index audit_log_org_occurred_at_idx on public.audit_log(org_id, occurred_at desc);
create index audit_log_client_occurred_at_idx on public.audit_log(client_id, occurred_at desc);
create index audit_log_actor_profile_id_idx on public.audit_log(actor_profile_id);

create function private.validate_checklist_item_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_item_id is not null and not exists (
    select 1
    from public.checklist_items as parent_item
    where parent_item.id = new.parent_item_id
      and parent_item.client_id = new.client_id
  ) then
    raise exception 'checklist parent must belong to the same client';
  end if;

  return new;
end;
$$;

create function private.validate_stage_history_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.changed_by is not null and not exists (
    select 1
    from public.profiles as actor
    join public.clients as client on client.id = new.client_id
    where actor.id = new.changed_by
      and (
        actor.role = 'platform_admin'
        or actor.org_id = client.org_id
      )
  ) then
    raise exception 'stage actor must be global or belong to the client organization';
  end if;

  return new;
end;
$$;

create function private.validate_audit_anchors()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is not null and new.client_id is not null and not exists (
    select 1
    from public.clients as client
    where client.id = new.client_id
      and client.org_id = new.org_id
  ) then
    raise exception 'audit organization and client anchors must agree';
  end if;

  return new;
end;
$$;

create trigger checklist_items_validate_parent
before insert or update of parent_item_id, client_id on public.checklist_items
for each row execute function private.validate_checklist_item_parent();

create trigger stage_history_validate_actor
before insert or update of client_id, changed_by on public.stage_history
for each row execute function private.validate_stage_history_actor();

create trigger stage_history_prevent_change
before update or delete on public.stage_history
for each row execute function private.prevent_row_change();

create trigger audit_log_validate_anchors
before insert or update of org_id, client_id on public.audit_log
for each row execute function private.validate_audit_anchors();

create trigger audit_log_prevent_change
before update or delete on public.audit_log
for each row execute function private.prevent_row_change();

revoke all on function private.derived_features_valid(jsonb) from public;
revoke all on function private.audit_meta_valid(jsonb) from public;
revoke all on function private.validate_checklist_item_parent() from public;
revoke all on function private.validate_stage_history_actor() from public;
revoke all on function private.validate_audit_anchors() from public;

alter table public.analysis_runs enable row level security;
alter table public.analysis_runs force row level security;
alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_templates force row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_items force row level security;
alter table public.checklist_item_state enable row level security;
alter table public.checklist_item_state force row level security;
alter table public.stage_history enable row level security;
alter table public.stage_history force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

revoke all on table public.analysis_runs from anon, authenticated;
revoke all on table public.plans from anon, authenticated;
revoke all on table public.checklist_templates from anon, authenticated;
revoke all on table public.checklist_items from anon, authenticated;
revoke all on table public.checklist_item_state from anon, authenticated;
revoke all on table public.stage_history from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;

grant select on table public.analysis_runs to authenticated;
grant select on table public.plans to authenticated;
grant select on table public.checklist_templates to authenticated;
grant select on table public.checklist_items to authenticated;
grant select on table public.checklist_item_state to authenticated;
grant select, insert on table public.stage_history to authenticated;
grant select on table public.audit_log to authenticated;
grant all on table public.analysis_runs to service_role;
grant all on table public.plans to service_role;
grant all on table public.checklist_templates to service_role;
grant all on table public.checklist_items to service_role;
grant all on table public.checklist_item_state to service_role;
grant all on table public.stage_history to service_role;
grant all on table public.audit_log to service_role;

create policy analysis_runs_select_authenticated
on public.analysis_runs
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy plans_select_authenticated
on public.plans
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy checklist_templates_select_authenticated
on public.checklist_templates
for select
to authenticated
using ((select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer'));

create policy checklist_items_select_authenticated
on public.checklist_items
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy checklist_item_state_select_authenticated
on public.checklist_item_state
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy stage_history_select_authenticated
on public.stage_history
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy stage_history_insert_authenticated
on public.stage_history
for insert
to authenticated
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member')
  and (select private.can_access_client(client_id))
);

create policy audit_log_select_authenticated
on public.audit_log
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or (
    client_id is not null
    and (select private.can_access_client(client_id))
  )
  or (
    client_id is null
    and (select private.auth_app_role()) = 'operator_member'
    and org_id = (select private.auth_org_id())
  )
);
