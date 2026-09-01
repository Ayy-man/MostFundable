-- Consumer notification delivery preferences.
--
-- The notification feed is an account-history surface, not a delivery queue. These
-- rows therefore control delivery choices only; they are deliberately not joined
-- into the feed read. Existing and future consumers start with every known event
-- category enabled in-app and email disabled.

begin;

create table public.consumer_notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint consumer_notification_preferences_pkey
    primary key (profile_id, event_type),
  constraint consumer_notification_preferences_event_type_valid
    check (event_type in (
      'monitoring_alert',
      'stage_change',
      'analysis_complete',
      'refresh_result',
      'enrollment_milestone',
      'document',
      'team_message',
      'application_update'
    ))
);

comment on table public.consumer_notification_preferences is
  'Per-consumer delivery choices. The durable notification feed remains available regardless of these values.';
comment on column public.consumer_notification_preferences.in_app_enabled is
  'Whether proactive in-app delivery is requested for this event type; feed history is unaffected.';
comment on column public.consumer_notification_preferences.email_enabled is
  'Whether email delivery is requested for this event type when that delivery path is configured.';

create function private.seed_consumer_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.role = 'consumer' then
    insert into public.consumer_notification_preferences (
      profile_id,
      event_type,
      in_app_enabled,
      email_enabled
    )
    select new.id, category.event_type, true, false
    from (
      values
        ('monitoring_alert'),
        ('stage_change'),
        ('analysis_complete'),
        ('refresh_result'),
        ('enrollment_milestone'),
        ('document'),
        ('team_message'),
        ('application_update')
    ) as category(event_type)
    on conflict (profile_id, event_type) do nothing;
  end if;
  return new;
end;
$fn$;

revoke all on function private.seed_consumer_notification_preferences()
  from public, anon, authenticated, service_role;

create trigger profiles_seed_consumer_notification_preferences
after insert or update of role on public.profiles
for each row execute function private.seed_consumer_notification_preferences();

-- Backfill every consumer that predates this migration with the conservative
-- defaults. The trigger above applies the same contract to later consumers.
insert into public.consumer_notification_preferences (
  profile_id,
  event_type,
  in_app_enabled,
  email_enabled
)
select profile.id, category.event_type, true, false
from public.profiles as profile
cross join (
  values
    ('monitoring_alert'),
    ('stage_change'),
    ('analysis_complete'),
    ('refresh_result'),
    ('enrollment_milestone'),
    ('document'),
    ('team_message'),
    ('application_update')
) as category(event_type)
where profile.role = 'consumer'
on conflict (profile_id, event_type) do nothing;

create function private.validate_consumer_notification_preference()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' and (
    new.profile_id is distinct from old.profile_id
    or new.event_type is distinct from old.event_type
  ) then
    raise exception using
      errcode = '42501',
      message = 'CONSUMER_NOTIFICATION_PREFERENCE_IDENTITY_IMMUTABLE';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$fn$;

revoke all on function private.validate_consumer_notification_preference()
  from public, anon, authenticated, service_role;

create trigger consumer_notification_preferences_validate
before insert or update on public.consumer_notification_preferences
for each row execute function private.validate_consumer_notification_preference();

alter table public.consumer_notification_preferences enable row level security;
alter table public.consumer_notification_preferences force row level security;

create policy consumer_notification_preferences_select_own
on public.consumer_notification_preferences
for select
to authenticated
using (
  (select private.auth_app_role()) = 'consumer'
  and profile_id = (select private.auth_profile_id())
);

create policy consumer_notification_preferences_insert_own
on public.consumer_notification_preferences
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'consumer'
  and profile_id = (select private.auth_profile_id())
  and (select private.tenant_write_allowed(private.auth_org_id()))
);

create policy consumer_notification_preferences_update_own
on public.consumer_notification_preferences
for update
to authenticated
using (
  (select private.auth_app_role()) = 'consumer'
  and profile_id = (select private.auth_profile_id())
  and (select private.tenant_write_allowed(private.auth_org_id()))
)
with check (
  (select private.auth_app_role()) = 'consumer'
  and profile_id = (select private.auth_profile_id())
  and (select private.tenant_write_allowed(private.auth_org_id()))
);

revoke all on table public.consumer_notification_preferences
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.consumer_notification_preferences
  to authenticated, service_role;
revoke delete, truncate on table public.consumer_notification_preferences
  from public, anon, authenticated, service_role;

create trigger consumer_notification_preferences_no_truncate
before truncate on public.consumer_notification_preferences
for each statement execute function public.append_only_guard();
alter table public.consumer_notification_preferences
  enable always trigger consumer_notification_preferences_no_truncate;

commit;
