-- Turn consumer event email on.
--
-- Migration 423 held `email_enabled` false with a check constraint because no dispatcher existed.
-- One does now (`web/src/lib/notifications/email-dispatch.ts`), hanging off the same in-app
-- delivery row the feed already uses, so this migration lifts the constraint, seeds the per-event
-- defaults the application states in `preferences.ts`, and lets an in-app delivery row claim an
-- email receipt so a retry re-claims instead of sending twice.

begin;

alter table public.consumer_notification_preferences
  drop constraint consumer_notification_preferences_email_unavailable;

comment on table public.consumer_notification_preferences is
  'Per-consumer event delivery choices. Disabled in-app categories are excluded from the derived feed; email delivery is dispatched off the in-app delivery row when the deployment has an email driver.';
comment on column public.consumer_notification_preferences.email_enabled is
  'Whether this event category is emailed. The email names the event kind and asks the consumer to sign in; it carries no amount, lender, task or message text.';

-- The defaults, in one place, matching CONSUMER_NOTIFICATION_EMAIL_DEFAULTS in the application:
-- on for a credit alert and a team message, off for the six the app surfaces on its own schedule.
create function private.consumer_notification_email_default(p_event_type text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_event_type in ('monitoring_alert', 'team_message');
$fn$;

revoke all on function private.consumer_notification_email_default(text)
  from public, anon, authenticated, service_role;

create or replace function private.seed_consumer_notification_preferences()
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
    select
      new.id,
      category.event_type,
      true,
      private.consumer_notification_email_default(category.event_type)
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

-- Every existing row was forced false by migration 423's constraint, so no consumer has ever
-- expressed an email choice. Applying the defaults to the existing rows is therefore the same
-- act as seeding them, not an override of anybody's decision.
update public.consumer_notification_preferences as preference
set email_enabled = private.consumer_notification_email_default(preference.event_type)
where preference.email_enabled
    is distinct from private.consumer_notification_email_default(preference.event_type);

-- Consumer event email reuses the in-app delivery row rather than creating a second outbox row:
-- one queued delivery, one email, one receipt, and the existing unique key on `delivery_id` is
-- what makes a job retry re-claim the accepted receipt instead of sending again.
alter table public.email_outbox
  drop constraint email_outbox_template_check,
  add constraint email_outbox_template_check check (
    template in (
      'operator_card_failure',
      'consumer_monitoring_alert',
      'consumer_stage_change',
      'consumer_analysis_complete',
      'consumer_refresh_result',
      'consumer_enrollment_milestone',
      'consumer_document',
      'consumer_team_message',
      'consumer_application_update'
    )
  );

create or replace function public.claim_email_delivery(
  p_delivery_id uuid,
  p_template text,
  p_recipient text
)
returns table (
  receipt_id uuid,
  delivery_id uuid,
  template text,
  status text,
  provider_ref text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_recipient text;
begin
  v_recipient := pg_catalog.lower(pg_catalog.btrim(p_recipient));
  if p_delivery_id is null
    or p_template is null
    or v_recipient is null
    or char_length(v_recipient) not between 3 and 320 then
    raise exception using errcode = 'P0001', message = 'EMAIL_CLAIM_INVALID';
  end if;

  if p_template = 'operator_card_failure' then
    select outbox.org_id into v_org_id
    from public.notification_delivery_outbox as outbox
    where outbox.id = p_delivery_id
      and outbox.channel = 'email'
      and outbox.email_template = p_template;
  elsif p_template like 'consumer\_%' then
    -- The in-app delivery row carries the client, and the client carries the tenant. No new
    -- outbox row is created, so a consumer email can only ever exist for a queued notification.
    select client.org_id into v_org_id
    from public.notification_delivery_outbox as outbox
    join public.clients as client on client.id = outbox.client_id
    where outbox.id = p_delivery_id
      and outbox.channel = 'in_app';
  else
    raise exception using errcode = 'P0001', message = 'EMAIL_CLAIM_INVALID';
  end if;

  if v_org_id is null then
    raise exception using errcode = 'P0001', message = 'EMAIL_DELIVERY_NOT_FOUND';
  end if;

  insert into public.email_outbox (
    org_id, delivery_id, template, recipient_hash, attempt_count
  ) values (
    v_org_id,
    p_delivery_id,
    p_template,
    pg_catalog.encode(extensions.digest(v_recipient, 'sha256'), 'hex'),
    1
  )
  on conflict on constraint email_outbox_delivery_id_key do update
  set status = case
        when email_outbox.status = 'accepted' then email_outbox.status
        else 'pending'::public.email_outbox_status
      end,
      recipient_hash = excluded.recipient_hash,
      provider_ref = case when email_outbox.status = 'accepted' then email_outbox.provider_ref else null end,
      error_code = null,
      accepted_at = case when email_outbox.status = 'accepted' then email_outbox.accepted_at else null end,
      attempt_count = case
        when email_outbox.status = 'accepted' then email_outbox.attempt_count
        else email_outbox.attempt_count + 1
      end,
      updated_at = pg_catalog.clock_timestamp();

  return query
  select row.id, row.delivery_id, row.template, row.status::text, row.provider_ref, row.attempt_count
  from public.email_outbox as row
  where row.delivery_id = p_delivery_id;
end;
$$;

revoke all on function public.claim_email_delivery(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_email_delivery(uuid, text, text) to service_role;

commit;
