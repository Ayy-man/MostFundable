-- One client may have many historical refreshes, but only one unresolved
-- payment/work chain. Both request creation and the first provider-dispatch
-- transition serialize on the client row, so a reload with a new idempotency
-- key cannot race a second Stripe PaymentIntent into existence.

begin;

-- The provider-money interval also has a physical backstop. It is Stripe-only
-- so historical mock fixtures cannot make a real-driver cutover fail, and it
-- covers the states that can race before the richer predicate reads jobs or
-- remediation state.
create unique index paid_refresh_one_open_stripe_payment_idx
  on public.paid_refresh_requests(client_id)
  where driver = 'stripe'
    and (
      state in ('initiated', 'requires_action', 'paid')
      or payment_attempt_state in ('dispatching', 'provider_returned', 'needs_review')
    );

create function private.paid_refresh_purchase_is_blocked(
  p_client_id uuid,
  p_driver text,
  p_exclude_request_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.paid_refresh_requests as request
    where request.client_id = p_client_id
      -- Production deliberately hides historical mock evidence. A later Stripe
      -- cutover must not be locked by a fixture request the consumer cannot see.
      and request.driver = p_driver
      and (p_exclude_request_id is null or request.id <> p_exclude_request_id)
      and (
        request.payment_attempt_state in ('dispatching', 'provider_returned', 'needs_review')
        -- `initiated` is the browser's payment_pending projection. It must
        -- block from creation onward because a concurrent command can take its
        -- MVCC snapshot before waiting on the client lock.
        or request.state in ('initiated', 'requires_action', 'paid')
        or (
          request.state = 'queued'
          and not exists (
            select 1
            from public.analysis_jobs as job
            left join public.analysis_runs as run
              on run.id = job.analysis_run_id
             and run.client_id = request.client_id
            where job.client_id = request.client_id
              and job.source_kind = 'force_pull'
              and job.source_id = request.id
              and job.trigger = 'force_pull'
              and (
                job.status in ('failed', 'cancelled')
                or (job.status = 'succeeded' and run.id is not null)
              )
          )
        )
        or (
          request.state = 'unfulfillable'
          and not exists (
            select 1
            from public.paid_refresh_remediations as remediation
            where remediation.request_id = request.id
              and remediation.state = 'resolved'
          )
        )
      )
  );
$fn$;

create or replace function public.create_paid_refresh_request(
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
as $fn$
declare
  v_request public.paid_refresh_requests;
  v_org_id uuid;
begin
  if p_actor_profile_id is null or p_client_id is null
    or p_idempotency_key is null or p_amount_cents is null
    or p_currency is null or p_driver is null then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_INPUT_INVALID';
  end if;

  -- This is the serialization authority shared with the payment-attempt RPC.
  select client.org_id into v_org_id
  from public.clients as client
  join public.profiles as actor
    on actor.id = p_actor_profile_id
   and actor.role = 'consumer'
  where client.id = p_client_id
    and client.consumer_profile_id = actor.id
  for update of client;

  if v_org_id is null then
    raise exception using errcode = '42501', message = 'PAID_REFRESH_SCOPE_INVALID';
  end if;

  -- Exact replay wins over the outstanding-work guard, so the original key
  -- remains the recovery path for action-required and crash states.
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.actor_profile_id = p_actor_profile_id
    and request.idempotency_key = p_idempotency_key;

  if v_request.id is not null then
    if v_request.client_id <> p_client_id
      or v_request.amount_cents <> p_amount_cents
      or v_request.currency <> p_currency
      or v_request.driver <> p_driver then
      raise exception using errcode = '22023', message = 'PAID_REFRESH_REPLAY_MISMATCH';
    end if;
    return next v_request;
    return;
  end if;

  if private.paid_refresh_purchase_is_blocked(p_client_id, p_driver) then
    raise exception using errcode = '55000', message = 'PAID_REFRESH_OUTSTANDING_REQUEST';
  end if;

  insert into public.paid_refresh_requests (
    actor_profile_id, client_id, org_id, idempotency_key,
    amount_cents, currency, driver
  ) values (
    p_actor_profile_id, p_client_id, v_org_id, p_idempotency_key,
    p_amount_cents, p_currency, p_driver
  )
  returning * into strict v_request;

  perform private.audit_paid_refresh_transition(v_request, 'absent', 'initiated');
  return next v_request;
end;
$fn$;

create or replace function public.begin_paid_refresh_payment_attempt(
  p_request_id uuid,
  p_idempotency_key text
) returns table (
  payment_attempt_state text,
  payment_idempotency_key text,
  payment_dispatch_started_at timestamptz,
  payment_provider_event_key text,
  payment_provider_payment_ref text,
  payment_provider_outcome text,
  payment_provider_returned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
  v_client_id uuid;
begin
  select request.client_id into v_client_id
  from public.paid_refresh_requests as request
  where request.id = p_request_id;
  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;

  -- Lock the same authority as request creation before locking the request.
  perform 1 from public.clients as client where client.id = v_client_id for update;
  select request.* into strict v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;

  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 255 then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_ATTEMPT_INVALID';
  end if;
  if v_request.payment_idempotency_key is not null
     and v_request.payment_idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_PAYMENT_ATTEMPT_MISMATCH';
  end if;

  if v_request.payment_attempt_state = 'none' then
    if private.paid_refresh_purchase_is_blocked(
      v_client_id, v_request.driver, v_request.id
    ) then
      raise exception using errcode = '55000', message = 'PAID_REFRESH_OUTSTANDING_REQUEST';
    end if;
    update public.paid_refresh_requests
    set payment_attempt_state = 'dispatching',
        payment_idempotency_key = p_idempotency_key,
        payment_dispatch_started_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = p_request_id
    returning * into strict v_request;
  end if;

  return query select
    v_request.payment_attempt_state,
    v_request.payment_idempotency_key,
    v_request.payment_dispatch_started_at,
    v_request.payment_provider_event_key,
    v_request.payment_provider_payment_ref,
    v_request.payment_provider_outcome,
    v_request.payment_provider_returned_at;
end;
$fn$;

-- The browser needs durable refresh status after a reload, but the payment,
-- analysis-job, and remediation tables intentionally grant no authenticated
-- SELECT. This definer is the only bridge: authenticated calls derive the actor
-- from auth.uid(), while the server-only demo path must name an active consumer
-- through its service-role client. Both authorities return the same closed,
-- provider-free status projection for at most the latest 100 requests.
create function public.consumer_paid_refresh_history(
  p_actor_id uuid default null,
  p_include_mock boolean default false
)
returns table (
  request_id uuid,
  amount_cents integer,
  currency text,
  requested_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor_id uuid;
  v_client_ids uuid[];
  v_client_id uuid;
  v_include_mock boolean := false;
begin
  if (select auth.role()) = 'authenticated' then
    if p_actor_id is not null then
      raise exception using errcode = '42501', message = 'PAID_REFRESH_HISTORY_FORBIDDEN';
    end if;
    v_actor_id := auth.uid();
    v_include_mock := p_include_mock is true
      and coalesce(
        auth.jwt() -> 'app_metadata' ->> 'paid_refresh_mock_history',
        'false'
      ) = 'true';
  elsif (select auth.role()) = 'service_role' then
    if p_actor_id is null then
      raise exception using errcode = '42501', message = 'PAID_REFRESH_HISTORY_FORBIDDEN';
    end if;
    v_actor_id := p_actor_id;
    v_include_mock := p_include_mock is true;
  else
    raise exception using errcode = '42501', message = 'PAID_REFRESH_HISTORY_FORBIDDEN';
  end if;

  if v_actor_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_actor_id
      and profile.role = 'consumer'
      and profile.disabled_at is null
  ) then
    raise exception using errcode = '42501', message = 'PAID_REFRESH_HISTORY_FORBIDDEN';
  end if;

  select pg_catalog.array_agg(client.id order by client.id)
  into v_client_ids
  from public.clients as client
  join public.profiles as profile
    on profile.id = client.consumer_profile_id
   and profile.id = v_actor_id
   and profile.org_id = client.org_id
  where client.status = 'active';

  if coalesce(pg_catalog.cardinality(v_client_ids), 0) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(v_client_ids) <> 1 then
    raise exception using errcode = '42501', message = 'PAID_REFRESH_HISTORY_SCOPE_INVALID';
  end if;
  v_client_id := v_client_ids[1];

  return query
  with scoped_requests as (
    select request.*
    from public.paid_refresh_requests as request
    where request.actor_profile_id = v_actor_id
      and request.client_id = v_client_id
      and (
        request.driver = 'stripe'
        or (v_include_mock and request.driver = 'mock')
      )
      and request.org_id = (
        select profile.org_id from public.profiles as profile where profile.id = v_actor_id
      )
    order by request.created_at desc, request.id desc
    limit 100
  )
  select
    request.id,
    request.amount_cents,
    request.currency,
    request.created_at,
    payment.occurred_at,
    case
      when payment.occurred_at is not null
        and job.status = 'succeeded'
        and analysis_run.id is not null
        and request.analysis_run_id = job.analysis_run_id
      then analysis_run.ran_at
      else null
    end,
    case
      -- A corrupt payment or mismatched linked job must fail closed in the
      -- application parser instead of being presented as a valid purchase.
      when payment.occurred_at is not null
        and (payment.amount_cents <> request.amount_cents or payment.currency <> request.currency)
      then 'invalid'
      when request.analysis_run_id is not null
        and job.analysis_run_id is not null
        and request.analysis_run_id <> job.analysis_run_id
      then 'invalid'
      when request.state = 'unfulfillable' and remediation.state = 'resolved' then 'remediated'
      when request.state = 'unfulfillable' then 'unfulfillable'
      when request.state = 'cancelled' then 'cancelled'
      when payment.occurred_at is null and request.payment_attempt_state = 'needs_review' then 'payment_review'
      when payment.occurred_at is null and request.state = 'requires_action' then 'payment_action_required'
      when payment.occurred_at is null and request.state = 'payment_failed' then 'payment_failed'
      when payment.occurred_at is null then 'payment_pending'
      when request.state = 'paid' then 'paid'
      when request.state <> 'queued' then 'paid'
      when job.analysis_run_id is null or job.status = 'queued' then 'queued'
      when job.status in ('running', 'persisted') then 'running'
      when job.status = 'failed' then 'failed'
      when job.status = 'cancelled' then 'cancelled'
      when job.status = 'succeeded' and analysis_run.id is not null then 'completed'
      else 'running'
    end
  from scoped_requests as request
  left join lateral (
    select event.amount_cents, event.currency, event.occurred_at
    from public.paid_refresh_payment_events as event
    where event.request_id = request.id
      and event.outcome = 'succeeded'
    order by event.occurred_at desc, event.id desc
    limit 1
  ) as payment on true
  left join lateral (
    select analysis_job.analysis_run_id, analysis_job.status, analysis_job.updated_at
    from public.analysis_jobs as analysis_job
    where analysis_job.client_id = v_client_id
      and analysis_job.source_kind = 'force_pull'
      and analysis_job.trigger = 'force_pull'
      and analysis_job.source_id = request.id
    order by analysis_job.updated_at desc, analysis_job.id desc
    limit 1
  ) as job on true
  left join public.analysis_runs as analysis_run
    on analysis_run.id = job.analysis_run_id
   and analysis_run.client_id = v_client_id
   and analysis_run.trigger = 'force_pull'
  left join public.paid_refresh_remediations as remediation
    on remediation.request_id = request.id
  order by request.created_at desc, request.id desc;
end;
$fn$;

revoke all on function private.paid_refresh_purchase_is_blocked(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_paid_refresh_request(uuid, uuid, text, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_paid_refresh_payment_attempt(uuid, text)
  from public, anon, authenticated;
revoke all on function public.consumer_paid_refresh_history(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_paid_refresh_request(uuid, uuid, text, integer, text, text)
  to service_role;
grant execute on function public.begin_paid_refresh_payment_attempt(uuid, text)
  to service_role;
grant execute on function public.consumer_paid_refresh_history(uuid, boolean)
  to authenticated, service_role;

commit;
