create type public.consent_kind as enum ('monitoring', 'analysis');
create type public.consent_action as enum ('granted', 'revoked');
create type public.enrollment_status as enum ('enrolled', 'parked', 'active', 'cancelled');
create type public.enrollment_milestone_kind as enum (
  'agreement_signed',
  'documents_uploaded',
  'monitoring_connected',
  'onboarding_call_completed'
);
create type public.crs_persona as enum ('clean', 'derog', 'thin_file', 'no_hit');

create table public.consents (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind public.consent_kind not null,
  action public.consent_action not null default 'granted',
  text_version text not null,
  signed_at timestamptz not null,
  ip inet not null,
  esig_ref text not null,
  supersedes_consent_id uuid references public.consents(id),
  created_at timestamptz not null default now(),
  constraint consents_action_link_check check (
    (action = 'granted' and supersedes_consent_id is null)
    or (
      action = 'revoked'
      and supersedes_consent_id is not null
      and supersedes_consent_id <> id
    )
  )
);

create table public.enrollments (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  crs_member_ref text unique,
  status public.enrollment_status not null default 'enrolled',
  monitoring_consent_at timestamptz not null,
  analysis_consent_at timestamptz not null,
  esig_doc_id text not null,
  idpass boolean not null default false,
  parked_until timestamptz,
  persona_hint public.crs_persona,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrollments_parked_state_check check (
    (status = 'parked' and parked_until is not null)
    or (status <> 'parked' and parked_until is null)
  )
);

create table public.enrollment_milestones (
  client_id uuid not null references public.clients(id) on delete cascade,
  kind public.enrollment_milestone_kind not null,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  primary key (client_id, kind),
  constraint enrollment_milestones_actor_check check (
    completed_at is not null
    or completed_by is null
  )
);

create table public.monitoring_events (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index consents_client_id_idx on public.consents(client_id);
create index consents_client_kind_signed_at_idx
  on public.consents(client_id, kind, signed_at desc);
create index consents_supersedes_consent_id_idx on public.consents(supersedes_consent_id);
create index enrollments_status_idx on public.enrollments(status);
create index enrollments_parked_until_idx on public.enrollments(parked_until);
create index enrollment_milestones_completed_by_idx on public.enrollment_milestones(completed_by);
create index monitoring_events_client_occurred_at_idx
  on public.monitoring_events(client_id, occurred_at desc);
create index monitoring_events_received_at_idx on public.monitoring_events(received_at);

create function private.prevent_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name;
end;
$$;

create function private.validate_consent_supersession()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action = 'revoked' and not exists (
    select 1
    from public.consents as prior_consent
    where prior_consent.id = new.supersedes_consent_id
      and prior_consent.client_id = new.client_id
      and prior_consent.kind = new.kind
      and prior_consent.action = 'granted'
      and prior_consent.signed_at <= new.signed_at
  ) then
    raise exception 'revoked consent must link to an earlier matching grant';
  end if;

  return new;
end;
$$;

create function private.validate_enrollment_consents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.consents as consent
    where consent.client_id = new.client_id
      and consent.kind = 'monitoring'
      and consent.action = 'granted'
      and consent.signed_at = new.monitoring_consent_at
      and consent.esig_ref = new.esig_doc_id
  ) then
    raise exception 'enrollment requires a matching monitoring consent grant';
  end if;

  if not exists (
    select 1
    from public.consents as consent
    where consent.client_id = new.client_id
      and consent.kind = 'analysis'
      and consent.action = 'granted'
      and consent.signed_at = new.analysis_consent_at
      and consent.esig_ref = new.esig_doc_id
  ) then
    raise exception 'enrollment requires a matching analysis consent grant';
  end if;

  return new;
end;
$$;

create trigger consents_validate_supersession
before insert on public.consents
for each row execute function private.validate_consent_supersession();

create trigger consents_prevent_change
before update or delete on public.consents
for each row execute function private.prevent_row_change();

create trigger enrollments_validate_consents
before insert or update of client_id, monitoring_consent_at, analysis_consent_at, esig_doc_id
on public.enrollments
for each row execute function private.validate_enrollment_consents();

revoke all on function private.prevent_row_change() from public;
revoke all on function private.validate_consent_supersession() from public;
revoke all on function private.validate_enrollment_consents() from public;

alter table public.consents enable row level security;
alter table public.consents force row level security;
alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;
alter table public.enrollment_milestones enable row level security;
alter table public.enrollment_milestones force row level security;
alter table public.monitoring_events enable row level security;
alter table public.monitoring_events force row level security;

revoke all on table public.consents from anon, authenticated;
revoke all on table public.enrollments from anon, authenticated;
revoke all on table public.enrollment_milestones from anon, authenticated;
revoke all on table public.monitoring_events from anon, authenticated;

grant select, insert on table public.consents to authenticated;
grant select, insert, update on table public.enrollments to authenticated;
grant select, insert, update on table public.enrollment_milestones to authenticated;
grant select on table public.monitoring_events to authenticated;
grant all on table public.consents to service_role;
grant all on table public.enrollments to service_role;
grant all on table public.enrollment_milestones to service_role;
grant all on table public.monitoring_events to service_role;

create policy consents_select_authenticated
on public.consents
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy consents_insert_authenticated
on public.consents
for insert
to authenticated
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
);

create policy enrollments_select_authenticated
on public.enrollments
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy enrollments_insert_authenticated
on public.enrollments
for insert
to authenticated
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
);

create policy enrollments_update_authenticated
on public.enrollments
for update
to authenticated
using (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
)
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
);

create policy enrollment_milestones_select_authenticated
on public.enrollment_milestones
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy enrollment_milestones_insert_authenticated
on public.enrollment_milestones
for insert
to authenticated
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
);

create policy enrollment_milestones_update_authenticated
on public.enrollment_milestones
for update
to authenticated
using (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
)
with check (
  (select private.auth_app_role()) in ('platform_admin', 'operator_member', 'consumer')
  and (select private.can_access_client(client_id))
);

create policy monitoring_events_select_authenticated
on public.monitoring_events
for select
to authenticated
using ((select private.can_access_client(client_id)));
