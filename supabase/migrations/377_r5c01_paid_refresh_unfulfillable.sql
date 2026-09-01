-- R5C-01 — a paid refresh that cannot lawfully be enqueued reaches a terminal, recoverable state.
--
-- **The defect.** Analysis consent can be revoked in the interval between the pre-charge
-- authorization check and `enqueueAnalysis`. Stripe has taken the money, the request sits in
-- `state='paid'` with `provider_payment_ref` set and `analysis_run_id` null, and the enqueue raises
-- `ANALYSIS_NOT_AUTHORIZED`. Replaying `createPaidRefresh` re-hits the initial authorization refusal
-- at the top of the function and returns before it ever reaches the already-paid recovery branch,
-- so the consumer has neither an analysis nor a refund and nothing in the system says so.
--
-- Round 1's R1C-15 made revocation authoritative at enqueue and made paid refresh refuse before
-- charging. It left the authority check and the money-moving call in separate transactions with the
-- whole provider interval between them, which is the interval this migration has to survive rather
-- than shrink: even a one-statement window can be lost to a crash.
--
-- **The terminal state.** `unfulfillable` means the money moved and the work can never be done.
-- It is genuinely terminal by construction, not by convention: `link_paid_refresh_analysis` already
-- requires `state = 'paid'`, and `advance_paid_refresh_payment` (337) already refuses any state
-- outside its five-state list, so neither can move a request back out of it.
--
-- **The obligation.** Terminality alone would still be a row nobody acts on, so every transition
-- into `unfulfillable` writes a `paid_refresh_remediations` row carrying the org, the amount and the
-- provider payment reference — everything an operator needs to refund or make good — and the row
-- stays `open` until `close_paid_refresh_remediation` records who resolved it and how. The
-- obligation is a separate table rather than six columns on the request because
-- `create_paid_refresh_request` and `link_paid_refresh_analysis` return `setof
-- public.paid_refresh_requests` and the repository mapper refuses a widened row, so widening the
-- request table would break every caller to record something none of them read.
--
-- **Where resolution happens.** Three points, all inside the money and consent paths, because F1's
-- non-goals rule out solving a money-path recovery with a job cadence.
--
--   1. Two ALWAYS triggers on the rows the authority is actually derived from — the analysis
--      consent revocation, and an enrollment reaching `cancelled` — sweep the client's
--      paid-and-inert requests in the same transaction that removes the authority. This is the
--      complete one: at the instant a request becomes unfulfillable it is recorded as such, whether
--      or not anyone ever calls the money path again. They are triggers rather than additions to
--      `enrollment_revoke_consent` and `enrollment_cancel_sub` deliberately: `enrollment_cancel_sub`
--      alone has been rewritten by 022, 260, 296, 354 and 355, and a rule that lives in a function
--      body is a rule the next rewrite drops. Round 5's recurring shape is exactly that — an
--      invariant held by a caller, with the authority left open underneath.
--   2. `resolve_paid_refresh_unfulfillable` is the inline half, called by `createPaidRefresh` when
--      the enqueue it just paid for refuses. It re-derives authorization itself rather than trusting
--      the caller's reading of the failure, so a transient enqueue failure leaves the request `paid`
--      and retryable and only a genuinely withdrawn authority terminalizes it.
--   3. `paid_refresh_analysis_authorization` replaces the bare authorization read at the top of
--      `createPaidRefresh`. When it refuses it resolves the client's debris in the same transaction
--      and hands back the request id belonging to this idempotency key, so a replay after a crash
--      reports the terminal state instead of the flat refusal that hid it.
--
-- Points 2 and 3 cover the crash windows around point 1; point 1 covers the consumer who never
-- comes back. A request can still sit `paid` after a transient enqueue failure with consent intact
-- — that is the rediscovery class (C-02) and it stays retryable on purpose.

begin;

-- =================================================================================================
-- The state
-- =================================================================================================

alter table public.paid_refresh_requests drop constraint paid_refresh_requests_state_closed;
alter table public.paid_refresh_requests add constraint paid_refresh_requests_state_closed check (
  state in ('initiated', 'payment_failed', 'requires_action', 'paid', 'queued', 'cancelled', 'unfulfillable')
);
alter table public.paid_refresh_requests drop constraint paid_refresh_requests_state_shape;
alter table public.paid_refresh_requests add constraint paid_refresh_requests_state_shape check (
  (state = 'initiated' and provider_payment_ref is null and analysis_run_id is null)
  or (state in ('payment_failed', 'requires_action', 'paid') and provider_payment_ref is not null and analysis_run_id is null)
  or (state = 'queued' and provider_payment_ref is not null and analysis_run_id is not null)
  or (state = 'cancelled' and provider_payment_ref is not null and analysis_run_id is null)
  -- The money moved and the work will not be done. Same shape as `paid`, and no way back.
  or (state = 'unfulfillable' and provider_payment_ref is not null and analysis_run_id is null)
);

-- =================================================================================================
-- The obligation
-- =================================================================================================

create table public.paid_refresh_remediations (
  request_id uuid primary key references public.paid_refresh_requests(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  amount_cents integer not null,
  currency text not null,
  -- Copied rather than joined: the operator resolving this needs the payment reference even after
  -- a derived-data purge has run over everything else the client owns.
  provider_payment_ref text not null,
  reason text not null,
  state text not null default 'open',
  opened_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  disposition text,
  constraint paid_refresh_remediations_amount_positive check (amount_cents > 0),
  constraint paid_refresh_remediations_currency_usd check (currency = 'usd'),
  constraint paid_refresh_remediations_provider_ref_bounded check (
    char_length(provider_payment_ref) between 1 and 255
    and provider_payment_ref = btrim(provider_payment_ref)
  ),
  -- Closed vocabularies, so nothing consumer-derived and no free text can ever land here.
  constraint paid_refresh_remediations_reason_closed check (
    reason in ('analysis_authorization_withdrawn', 'enrollment_cancelled')
  ),
  constraint paid_refresh_remediations_state_closed check (state in ('open', 'resolved')),
  constraint paid_refresh_remediations_disposition_closed check (
    disposition is null or disposition in ('refunded', 'fulfilled', 'written_off')
  ),
  constraint paid_refresh_remediations_shape check (
    (state = 'open' and resolved_at is null and resolved_by is null and disposition is null)
    or (state = 'resolved' and resolved_at is not null and resolved_by is not null and disposition is not null)
  ),
  constraint paid_refresh_remediations_resolution_order check (
    resolved_at is null or resolved_at >= opened_at
  )
);

create index paid_refresh_remediations_open_idx
  on public.paid_refresh_remediations(org_id, opened_at)
  where state = 'open';

alter table public.paid_refresh_remediations enable row level security;
alter table public.paid_refresh_remediations force row level security;
revoke all on table public.paid_refresh_remediations from public, anon, authenticated, service_role;
grant select on table public.paid_refresh_remediations to service_role;

-- R5A-01. This table carries a durable evidence record a product invariant depends on continuing to
-- exist, so it is inside 374's boundary and takes the boundary's treatment here rather than waiting
-- for a later sweep. `private.erasure_boundary_violations()` is the test of that, not this comment.
create trigger paid_refresh_remediations_no_truncate
before truncate on public.paid_refresh_remediations
for each statement execute function public.append_only_guard();
alter table public.paid_refresh_remediations
  enable always trigger paid_refresh_remediations_no_truncate;

-- =================================================================================================
-- The transition
-- =================================================================================================

create function private.resolve_unfulfillable_paid_refreshes(
  p_client_id uuid,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
  v_count integer := 0;
begin
  -- Paid, no run linked: the money moved and nothing was ever queued for it. `queued` is excluded
  -- because that work exists and is cancelled by its own path; `cancelled` is 292's terminal state
  -- for a request whose run was purged and is already accounted for.
  for v_request in
    select request.*
    from public.paid_refresh_requests as request
    where request.client_id = p_client_id
      and request.state = 'paid'
      and request.analysis_run_id is null
    order by request.created_at, request.id
    for update
  loop
    update public.paid_refresh_requests
    set state = 'unfulfillable', updated_at = pg_catalog.clock_timestamp()
    where id = v_request.id
    returning * into strict v_request;

    insert into public.paid_refresh_remediations (
      request_id, client_id, org_id, amount_cents, currency, provider_payment_ref, reason
    ) values (
      v_request.id, v_request.client_id, v_request.org_id, v_request.amount_cents,
      v_request.currency, v_request.provider_payment_ref, p_reason
    )
    on conflict (request_id) do nothing;

    -- The consumer is not going to get a pull for this, so the capacity it reserved goes back.
    perform public.release_paid_refresh_pull(v_request.id);
    perform private.audit_paid_refresh_transition(v_request, 'paid', 'unfulfillable', p_reason);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

-- The inline half. Re-derives the authority rather than trusting the caller's reading of why the
-- enqueue failed, so only a genuinely withdrawn authority is terminal and everything else stays
-- retryable.
create function public.resolve_paid_refresh_unfulfillable(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request public.paid_refresh_requests;
begin
  select request.* into v_request
  from public.paid_refresh_requests as request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception using errcode = 'P0002', message = 'PAID_REFRESH_NOT_FOUND';
  end if;
  if v_request.state = 'unfulfillable' then
    return true;
  end if;
  if v_request.state <> 'paid' or v_request.analysis_run_id is not null then
    return false;
  end if;
  if private.analysis_authorized(v_request.client_id) then
    return false;
  end if;

  return private.resolve_unfulfillable_paid_refreshes(
    v_request.client_id, 'analysis_authorization_withdrawn'
  ) > 0;
end;
$fn$;

-- The replay half. One call in the position the bare authorization read used to occupy, so the
-- decision and the resolution of everything that decision strands are one transaction.
create function public.paid_refresh_analysis_authorization(
  p_client_id uuid,
  p_actor_profile_id uuid,
  p_idempotency_key text
) returns table (authorized boolean, unfulfillable_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_request_id uuid;
begin
  if private.analysis_authorized(p_client_id) then
    return query select true, null::uuid;
    return;
  end if;

  perform private.resolve_unfulfillable_paid_refreshes(
    p_client_id, 'analysis_authorization_withdrawn'
  );

  select request.id into v_request_id
  from public.paid_refresh_requests as request
  where request.actor_profile_id = p_actor_profile_id
    and request.idempotency_key = p_idempotency_key
    and request.client_id = p_client_id
    and request.state = 'unfulfillable';

  return query select false, v_request_id;
end;
$fn$;

-- The resolve verb. Without it the queue could only ever fill.
create function public.close_paid_refresh_remediation(
  p_request_id uuid,
  p_actor_profile_id uuid,
  p_disposition text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_updated boolean;
begin
  if p_disposition is null or p_disposition not in ('refunded', 'fulfilled', 'written_off') then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_REMEDIATION_DISPOSITION_INVALID';
  end if;
  if p_actor_profile_id is null then
    raise exception using errcode = '22023', message = 'PAID_REFRESH_REMEDIATION_ACTOR_INVALID';
  end if;

  update public.paid_refresh_remediations
  set state = 'resolved',
      resolved_at = pg_catalog.clock_timestamp(),
      resolved_by = p_actor_profile_id,
      disposition = p_disposition
  where request_id = p_request_id
    and state = 'open';
  v_updated := found;

  return v_updated;
end;
$fn$;

-- =================================================================================================
-- The authorities sweep in their own transaction
-- =================================================================================================
--
-- `private.analysis_authorized` reads three things: an active enrollment, an active consumer
-- subscription on it, and an analysis consent with no later revocation. The sweep hangs off the two
-- that do not come back on their own — the revocation, and the enrollment reaching `cancelled` —
-- rather than off whichever function happens to perform them today. A subscription leaving `active`
-- is deliberately not a sweep trigger: `past_due` returns to `active` routinely, and terminalizing a
-- paid request on a state that recovers would queue an operator obligation the system is about to
-- be able to discharge itself. That case is still covered, just later: points 2 and 3 re-derive the
-- authority in full, so the first time the money path touches such a request it terminalizes.
--
-- Both triggers are ALWAYS, so they bind the table owner as well as every definer, and both
-- re-derive the authority rather than assuming the row they fired on removed it — consent can be
-- re-granted with a later `signed_at`, and a cancelled enrollment need not be the client's only one.

create function private.sweep_unfulfillable_paid_refreshes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_client_id uuid := new.client_id;
begin
  if v_client_id is null then return null; end if;
  -- Re-derive rather than assume: an analysis consent can be revoked and re-granted, and a
  -- cancelled enrollment is not the client's only enrollment.
  if private.analysis_authorized(v_client_id) then return null; end if;
  perform private.resolve_unfulfillable_paid_refreshes(v_client_id, tg_argv[0]);
  return null;
end;
$fn$;

create trigger consent_revocations_sweep_unfulfillable_paid_refreshes
after insert on public.consent_revocations
for each row
when (new.kind = 'analysis')
execute function private.sweep_unfulfillable_paid_refreshes('analysis_authorization_withdrawn');
alter table public.consent_revocations
  enable always trigger consent_revocations_sweep_unfulfillable_paid_refreshes;

create trigger enrollments_sweep_unfulfillable_paid_refreshes
after update of status on public.enrollments
for each row
when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
execute function private.sweep_unfulfillable_paid_refreshes('enrollment_cancelled');
alter table public.enrollments
  enable always trigger enrollments_sweep_unfulfillable_paid_refreshes;

-- =================================================================================================
-- Grants
-- =================================================================================================

revoke all on function private.resolve_unfulfillable_paid_refreshes(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.sweep_unfulfillable_paid_refreshes()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_paid_refresh_unfulfillable(uuid)
  from public, anon, authenticated;
revoke all on function public.paid_refresh_analysis_authorization(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.close_paid_refresh_remediation(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_paid_refresh_unfulfillable(uuid) to service_role;
grant execute on function public.paid_refresh_analysis_authorization(uuid, uuid, text) to service_role;
grant execute on function public.close_paid_refresh_remediation(uuid, uuid, text) to service_role;

commit;
