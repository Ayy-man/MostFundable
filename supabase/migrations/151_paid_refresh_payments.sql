begin;

create table public.paid_refresh_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  idempotency_key text not null,
  amount_cents integer not null,
  currency text not null,
  driver text not null,
  state text not null default 'initiated',
  provider_payment_ref text,
  analysis_run_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint paid_refresh_requests_actor_key_unique
    unique (actor_profile_id, idempotency_key),
  constraint paid_refresh_requests_idempotency_bounded
    check (char_length(idempotency_key) between 1 and 128 and idempotency_key = btrim(idempotency_key)),
  constraint paid_refresh_requests_amount_positive check (amount_cents > 0),
  constraint paid_refresh_requests_currency_usd check (currency = 'usd'),
  constraint paid_refresh_requests_driver_closed check (driver in ('mock', 'stripe')),
  constraint paid_refresh_requests_state_closed check (
    state in ('initiated', 'payment_failed', 'requires_action', 'paid', 'queued')
  ),
  constraint paid_refresh_requests_provider_ref_bounded check (
    provider_payment_ref is null
    or (char_length(provider_payment_ref) between 1 and 255 and provider_payment_ref = btrim(provider_payment_ref))
  ),
  constraint paid_refresh_requests_state_shape check (
    (state = 'initiated' and provider_payment_ref is null and analysis_run_id is null)
    or (state in ('payment_failed', 'requires_action', 'paid') and provider_payment_ref is not null and analysis_run_id is null)
    or (state = 'queued' and provider_payment_ref is not null and analysis_run_id is not null)
  ),
  constraint paid_refresh_requests_analysis_run_fk
    foreign key (analysis_run_id) references public.analysis_jobs(analysis_run_id),
  constraint paid_refresh_requests_timestamp_order check (updated_at >= created_at)
);

create index paid_refresh_requests_client_created_idx
  on public.paid_refresh_requests(client_id, created_at desc);

create table public.paid_refresh_payment_events (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references public.paid_refresh_requests(id) on delete restrict,
  provider_event_key text not null unique,
  provider_payment_ref text not null,
  outcome text not null,
  amount_cents integer not null,
  currency text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint paid_refresh_events_event_key_bounded check (
    char_length(provider_event_key) between 1 and 255 and provider_event_key = btrim(provider_event_key)
  ),
  constraint paid_refresh_events_payment_ref_bounded check (
    char_length(provider_payment_ref) between 1 and 255 and provider_payment_ref = btrim(provider_payment_ref)
  ),
  constraint paid_refresh_events_outcome_closed check (
    outcome in ('succeeded', 'requires_action', 'failed')
  ),
  constraint paid_refresh_events_amount_positive check (amount_cents > 0),
  constraint paid_refresh_events_currency_usd check (currency = 'usd')
);

create unique index paid_refresh_events_one_success_per_request
  on public.paid_refresh_payment_events(request_id)
  where outcome = 'succeeded';
create index paid_refresh_events_request_occurred_idx
  on public.paid_refresh_payment_events(request_id, occurred_at, id);

alter table public.paid_refresh_requests enable row level security;
alter table public.paid_refresh_requests force row level security;
alter table public.paid_refresh_payment_events enable row level security;
alter table public.paid_refresh_payment_events force row level security;

revoke all on table public.paid_refresh_requests from public, anon, authenticated;
revoke all on table public.paid_refresh_payment_events from public, anon, authenticated;
grant select on table public.paid_refresh_requests to service_role;
grant select on table public.paid_refresh_payment_events to service_role;

create function private.reject_paid_refresh_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'PAID_REFRESH_EVENT_IMMUTABLE';
end;
$$;

create trigger paid_refresh_payment_events_immutable
before update or delete on public.paid_refresh_payment_events
for each row execute function private.reject_paid_refresh_event_mutation();

create function private.audit_paid_refresh_transition(
  p_request public.paid_refresh_requests,
  p_from_state text,
  p_to_state text,
  p_status text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
  ) values (
    p_request.org_id,
    p_request.client_id,
    p_request.actor_profile_id,
    'paid_refresh.transition',
    'paid_refresh_request',
    p_request.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'driver', p_request.driver,
      'from_state', p_from_state,
      'to_state', p_to_state,
      'status', p_status
    ))
  );
$$;

create function public.create_paid_refresh_request(
  p_actor_profile_id uuid,
  p_client_id uuid,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency text,
  p_driver text
)
returns setof public.paid_refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.paid_refresh_requests;
  v_org_id uuid;
  v_inserted boolean := false;
begin
  if p_actor_profile_id is null or p_client_id is null
    or p_idempotency_key is null or p_amount_cents is null
    or p_currency is null or p_driver is null then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_INPUT_INVALID';
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  join public.profiles as actor
    on actor.id = p_actor_profile_id
   and actor.role = 'consumer'
  where client.id = p_client_id
    and client.consumer_profile_id = actor.id;

  if v_org_id is null then
    raise exception using errcode = '42501', message = 'PAID_REFRESH_SCOPE_INVALID';
  end if;

  insert into public.paid_refresh_requests (
    actor_profile_id, client_id, org_id, idempotency_key,
    amount_cents, currency, driver
  ) values (
    p_actor_profile_id, p_client_id, v_org_id, p_idempotency_key,
    p_amount_cents, p_currency, p_driver
  )
  on conflict (actor_profile_id, idempotency_key) do nothing
  returning * into v_request;

  if v_request.id is null then
    select request.* into strict v_request
    from public.paid_refresh_requests as request
    where request.actor_profile_id = p_actor_profile_id
      and request.idempotency_key = p_idempotency_key;

    if v_request.client_id <> p_client_id
      or v_request.amount_cents <> p_amount_cents
      or v_request.currency <> p_currency
      or v_request.driver <> p_driver then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_REPLAY_MISMATCH';
    end if;
  else
    v_inserted := true;
  end if;

  if v_inserted then
    perform private.audit_paid_refresh_transition(v_request, 'absent', 'initiated');
  end if;

  return next v_request;
end;
$$;

create function public.record_paid_refresh_payment_event(
  p_request_id uuid,
  p_provider_event_key text,
  p_provider_payment_ref text,
  p_outcome text,
  p_amount_cents integer,
  p_currency text
)
returns setof public.paid_refresh_payment_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.paid_refresh_requests;
  v_event public.paid_refresh_payment_events;
  v_previous_state text;
  v_next_state text;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;

  if p_amount_cents is distinct from v_request.amount_cents
    or p_currency is distinct from v_request.currency
    or p_outcome is null
    or p_outcome not in ('succeeded', 'requires_action', 'failed') then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_MISMATCH';
  end if;

  select event.* into v_event
  from public.paid_refresh_payment_events as event
  where event.provider_event_key = p_provider_event_key;
  if v_event.id is not null then
    if v_event.request_id <> p_request_id
      or v_event.provider_payment_ref <> p_provider_payment_ref
      or v_event.outcome <> p_outcome
      or v_event.amount_cents <> p_amount_cents
      or v_event.currency <> p_currency then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_EVENT_REPLAY_MISMATCH';
    end if;
    return next v_event;
    return;
  end if;

  if v_request.state in ('paid', 'queued') and p_outcome <> 'succeeded' then
    raise exception using errcode = '55000', message = 'PAID_REFRESH_ALREADY_PAID';
  end if;

  insert into public.paid_refresh_payment_events (
    request_id, provider_event_key, provider_payment_ref,
    outcome, amount_cents, currency
  ) values (
    p_request_id, p_provider_event_key, p_provider_payment_ref,
    p_outcome, p_amount_cents, p_currency
  )
  returning * into strict v_event;

  v_previous_state := v_request.state;
  v_next_state := case p_outcome
    when 'succeeded' then 'paid'
    when 'requires_action' then 'requires_action'
    else 'payment_failed'
  end;

  update public.paid_refresh_requests
  set state = v_next_state,
      provider_payment_ref = p_provider_payment_ref,
      updated_at = clock_timestamp()
  where id = p_request_id
  returning * into strict v_request;

  perform private.audit_paid_refresh_transition(
    v_request, v_previous_state, v_next_state, p_outcome
  );

  return next v_event;
end;
$$;

create function public.read_paid_refresh_request(p_request_id uuid)
returns table (
  request_id uuid,
  actor_profile_id uuid,
  client_id uuid,
  amount_cents integer,
  currency text,
  driver text,
  state text,
  provider_payment_ref text,
  analysis_run_id uuid,
  payment_succeeded boolean,
  latest_payment_outcome text
)
language sql
security definer
set search_path = ''
as $$
  select
    request.id,
    request.actor_profile_id,
    request.client_id,
    request.amount_cents,
    request.currency,
    request.driver,
    request.state,
    request.provider_payment_ref,
    request.analysis_run_id,
    exists (
      select 1 from public.paid_refresh_payment_events as succeeded_event
      where succeeded_event.request_id = request.id
        and succeeded_event.outcome = 'succeeded'
        and succeeded_event.amount_cents = request.amount_cents
        and succeeded_event.currency = request.currency
    ),
    (
      select event.outcome
      from public.paid_refresh_payment_events as event
      where event.request_id = request.id
      order by event.occurred_at desc, event.id desc
      limit 1
    )
  from public.paid_refresh_requests as request
  where request.id = p_request_id;
$$;

create function public.link_paid_refresh_analysis(
  p_request_id uuid,
  p_analysis_run_id uuid
)
returns setof public.paid_refresh_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.paid_refresh_requests;
  v_previous_state text;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;
  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;
  if v_request.analysis_run_id is not null then
    if v_request.analysis_run_id <> p_analysis_run_id then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_ANALYSIS_MISMATCH';
    end if;
    return next v_request;
    return;
  end if;
  if v_request.state <> 'paid' or not exists (
    select 1
    from public.analysis_jobs as analysis_job
    where analysis_job.analysis_run_id = p_analysis_run_id
      and analysis_job.client_id = v_request.client_id
      and analysis_job.source_kind = 'force_pull'
      and analysis_job.source_id = v_request.id
      and analysis_job.trigger = 'force_pull'
  ) then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_ANALYSIS_INVALID';
  end if;

  v_previous_state := v_request.state;
  update public.paid_refresh_requests
  set state = 'queued', analysis_run_id = p_analysis_run_id, updated_at = clock_timestamp()
  where id = p_request_id
  returning * into strict v_request;
  perform private.audit_paid_refresh_transition(v_request, v_previous_state, 'queued');
  return next v_request;
end;
$$;

create or replace function public.enqueue_analysis_job(
  p_client_id uuid,
  p_source_kind public.analysis_job_source_kind,
  p_source_id uuid,
  p_trigger public.analysis_trigger
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.analysis_jobs;
  v_inserted boolean := false;
begin
  if p_source_kind = 'enrollment' then
    if p_trigger <> 'scheduled' or not exists (
      select 1 from public.enrollments as enrollment
      where enrollment.id = p_source_id and enrollment.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'monitoring_event' then
    if p_trigger <> 'alert' or not exists (
      select 1 from public.monitoring_events as event
      where event.id = p_source_id and event.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'document_upload' then
    if p_trigger <> 'upload' or not exists (
      select 1 from public.document_uploads as upload
      where upload.id = p_source_id
        and upload.client_id = p_client_id
        and upload.kind = 'credit_report'
        and upload.lifecycle = 'purged'
        and private.derived_features_valid(upload.derived_features)
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'force_pull' then
    if p_trigger <> 'force_pull' or not exists (
      select 1
      from public.paid_refresh_requests as request
      join public.paid_refresh_payment_events as payment_event
        on payment_event.request_id = request.id
       and payment_event.outcome = 'succeeded'
       and payment_event.amount_cents = request.amount_cents
       and payment_event.currency = request.currency
      where request.id = p_source_id
        and request.client_id = p_client_id
        and request.state in ('paid', 'queued')
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
  end if;

  insert into public.analysis_jobs (client_id, source_kind, source_id, trigger)
  values (p_client_id, p_source_kind, p_source_id, p_trigger)
  on conflict on constraint analysis_jobs_source_unique do nothing
  returning * into v_job;

  if v_job.id is not null then
    v_inserted := true;
  else
    select job_row.* into strict v_job
    from public.analysis_jobs as job_row
    where job_row.job = 'analysis.run'
      and job_row.subject = 'client:'::text || p_client_id::text
      and job_row.source_kind = p_source_kind
      and job_row.source_id = p_source_id;
  end if;

  if v_inserted then
    perform private.audit_analysis_job_transition(v_job, 'absent', 'queued');
  end if;
  return next v_job;
end;
$$;

revoke all on function private.reject_paid_refresh_event_mutation() from public;
revoke all on function private.audit_paid_refresh_transition(public.paid_refresh_requests, text, text, text) from public;
revoke all on function public.create_paid_refresh_request(uuid, uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.record_paid_refresh_payment_event(uuid, text, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.read_paid_refresh_request(uuid)
  from public, anon, authenticated;
revoke all on function public.link_paid_refresh_analysis(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.enqueue_analysis_job(uuid, public.analysis_job_source_kind, uuid, public.analysis_trigger)
  from public, anon, authenticated;

grant execute on function public.create_paid_refresh_request(uuid, uuid, text, integer, text, text)
  to service_role;
grant execute on function public.record_paid_refresh_payment_event(uuid, text, text, text, integer, text)
  to service_role;
grant execute on function public.read_paid_refresh_request(uuid)
  to service_role;
grant execute on function public.link_paid_refresh_analysis(uuid, uuid)
  to service_role;
grant execute on function public.enqueue_analysis_job(uuid, public.analysis_job_source_kind, uuid, public.analysis_trigger)
  to service_role;

commit;
