create type public.notification_delivery_channel as enum ('in_app', 'email');
create type public.email_outbox_status as enum ('pending', 'accepted', 'failed');

alter table public.notification_delivery_outbox
  alter column notification_id drop not null,
  alter column client_id drop not null,
  add column channel public.notification_delivery_channel not null default 'in_app',
  add column org_id uuid references public.orgs(id) on delete cascade,
  add column billing_event_id uuid references public.operator_billing_events(id) on delete cascade,
  add column email_template text,
  add column dispatch_subject text generated always as (
    case channel
      when 'in_app' then 'client:'::text || client_id::text
      when 'email' then 'org:'::text || org_id::text
    end
  ) stored,
  add column dispatch_window text generated always as (
    case channel
      when 'in_app' then 'notification:'::text || notification_id::text
      when 'email' then 'billing-event:'::text || billing_event_id::text
    end
  ) stored,
  add constraint notification_delivery_source_shape check (
    (
      channel = 'in_app'
      and notification_id is not null
      and client_id is not null
      and org_id is null
      and billing_event_id is null
      and email_template is null
    )
    or (
      channel = 'email'
      and notification_id is null
      and client_id is null
      and org_id is not null
      and billing_event_id is not null
      and email_template = 'operator_card_failure'
    )
  ),
  add constraint notification_delivery_email_template_check check (
    email_template is null or email_template = 'operator_card_failure'
  );

create unique index notification_delivery_email_billing_event_unique
  on public.notification_delivery_outbox(billing_event_id)
  where channel = 'email';

create function public.enqueue_operator_card_failure_email(
  p_org_id uuid,
  p_event_id text
)
returns table (delivery_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billing_event_id uuid;
  v_delivery_id uuid;
  v_inserted boolean;
begin
  if p_org_id is null or p_event_id is null or char_length(p_event_id) not between 1 and 255 then
    raise exception using errcode = 'P0001', message = 'EMAIL_EVENT_INVALID';
  end if;

  select event.id into v_billing_event_id
  from public.operator_billing_events as event
  where event.org_id = p_org_id
    and event.event_id = p_event_id
    and event.applied
    and event.to_membership in ('past_due', 'grace');

  if v_billing_event_id is null then
    raise exception using errcode = 'P0001', message = 'EMAIL_EVENT_NOT_ELIGIBLE';
  end if;

  insert into public.notification_delivery_outbox (
    channel,
    org_id,
    billing_event_id,
    email_template
  ) values (
    'email',
    p_org_id,
    v_billing_event_id,
    'operator_card_failure'
  )
  on conflict do nothing
  returning id into v_delivery_id;

  v_inserted := v_delivery_id is not null;
  if not v_inserted then
    select outbox.id into v_delivery_id
    from public.notification_delivery_outbox as outbox
    where outbox.channel = 'email'
      and outbox.billing_event_id = v_billing_event_id;
  end if;

  return query select v_delivery_id, v_inserted;
end;
$$;

create table public.email_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  delivery_id uuid not null unique
    references public.notification_delivery_outbox(id) on delete cascade,
  template text not null,
  recipient_hash text not null,
  status public.email_outbox_status not null default 'pending',
  provider_ref text,
  error_code text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint email_outbox_template_check check (template = 'operator_card_failure'),
  constraint email_outbox_recipient_hash_check check (recipient_hash ~ '^[0-9a-f]{64}$'),
  constraint email_outbox_provider_ref_bound check (
    provider_ref is null or char_length(provider_ref) between 1 and 255
  ),
  constraint email_outbox_error_code_bound check (
    error_code is null or char_length(error_code) between 1 and 64
  ),
  constraint email_outbox_attempt_nonnegative check (attempt_count >= 0),
  constraint email_outbox_state_shape check (
    (status = 'pending' and provider_ref is null and error_code is null and accepted_at is null)
    or (status = 'accepted' and provider_ref is not null and error_code is null and accepted_at is not null)
    or (status = 'failed' and provider_ref is null and error_code is not null and accepted_at is null)
  )
);

alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
revoke all on table public.email_outbox from public, anon, authenticated;
grant all on table public.email_outbox to service_role;

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
    or p_template <> 'operator_card_failure'
    or v_recipient is null
    or char_length(v_recipient) not between 3 and 320 then
    raise exception using errcode = 'P0001', message = 'EMAIL_CLAIM_INVALID';
  end if;

  select outbox.org_id into v_org_id
  from public.notification_delivery_outbox as outbox
  where outbox.id = p_delivery_id
    and outbox.channel = 'email'
    and outbox.email_template = p_template;
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

create or replace function public.accept_email_delivery(
  p_receipt_id uuid,
  p_provider_ref text
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
begin
  if p_receipt_id is null
    or p_provider_ref is null
    or char_length(p_provider_ref) not between 1 and 255 then
    raise exception using errcode = 'P0001', message = 'EMAIL_PROVIDER_REF_INVALID';
  end if;

  update public.email_outbox as target
  set status = 'accepted',
      provider_ref = p_provider_ref,
      error_code = null,
      accepted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where target.id = p_receipt_id
    and target.status <> 'accepted';

  return query
  select row.id, row.delivery_id, row.template, row.status::text, row.provider_ref, row.attempt_count
  from public.email_outbox as row
  where row.id = p_receipt_id;
end;
$$;

create or replace function public.fail_email_delivery(
  p_receipt_id uuid,
  p_error_code text
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
begin
  if p_receipt_id is null
    or p_error_code is null
    or char_length(p_error_code) not between 1 and 64
    or p_error_code !~ '^[A-Z0-9_]+$' then
    raise exception using errcode = 'P0001', message = 'EMAIL_ERROR_CODE_INVALID';
  end if;

  update public.email_outbox as target
  set status = 'failed',
      provider_ref = null,
      error_code = p_error_code,
      accepted_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where target.id = p_receipt_id
    and target.status <> 'accepted';

  return query
  select row.id, row.delivery_id, row.template, row.status::text, row.provider_ref, row.attempt_count
  from public.email_outbox as row
  where row.id = p_receipt_id;
end;
$$;

create view public.notification_delivery_dispatch_view
with (security_invoker = true)
as
select
  id,
  channel,
  dispatch_subject,
  dispatch_window,
  org_id,
  billing_event_id,
  email_template,
  status
from public.notification_delivery_outbox;

revoke all on table public.notification_delivery_dispatch_view from public, anon, authenticated;
grant select on table public.notification_delivery_dispatch_view to service_role;

create or replace function public.dispatch_notification(
  p_subject text,
  p_window text,
  p_worker uuid
)
returns table (status text, rows integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.notification_delivery_outbox;
  v_at timestamptz;
begin
  if p_worker is null
    or p_subject is null
    or p_window is null
    or not (
      (p_subject ~ '^client:[0-9a-fA-F-]{36}$' and p_window ~ '^notification:[0-9a-fA-F-]{36}$')
      or (p_subject ~ '^org:[0-9a-fA-F-]{36}$' and p_window ~ '^billing-event:[0-9a-fA-F-]{36}$')
    ) then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_DISPATCH_KEY_INVALID';
  end if;

  select outbox.* into v_outbox
  from public.notification_delivery_outbox as outbox
  where outbox.dispatch_subject = p_subject
    and outbox.dispatch_window = p_window
  for update;

  if v_outbox.id is null or v_outbox.status = 'delivered' then
    return query select 'skipped'::text, 0;
    return;
  end if;

  v_at := pg_catalog.clock_timestamp();
  update public.notification_delivery_outbox
  set status = 'delivered',
      attempt_count = attempt_count + 1,
      lease_owner = null,
      lease_until = null,
      error_code = null,
      delivered_at = v_at,
      updated_at = v_at
  where id = v_outbox.id;

  if v_outbox.channel = 'in_app' then
    update public.outcome_notifications
    set delivered_at = v_at
    where id = v_outbox.notification_id;
  end if;

  return query select 'ok'::text, 1;
end;
$$;

revoke all on function public.enqueue_operator_card_failure_email(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_email_delivery(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.accept_email_delivery(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_email_delivery(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dispatch_notification(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_operator_card_failure_email(uuid, text) to service_role;
grant execute on function public.claim_email_delivery(uuid, text, text) to service_role;
grant execute on function public.accept_email_delivery(uuid, text) to service_role;
grant execute on function public.fail_email_delivery(uuid, text) to service_role;
grant execute on function public.dispatch_notification(text, text, uuid) to service_role;
