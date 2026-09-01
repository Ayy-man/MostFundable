-- R5C-01 — a paid refresh whose authority disappears cannot stay paid and inert.
--
-- Reviewer's reproduction: charge succeeds, analysis consent is revoked in the provider interval,
-- `enqueueAnalysis` raises `ANALYSIS_NOT_AUTHORIZED`, and the request sits `state='paid'` with
-- `provider_payment_ref` set and `analysis_run_id` null forever, because a replay re-hits the
-- authorization refusal at the top of `createPaidRefresh` and returns before the recovery branch.
--
-- The central assertion here is deliberately not "this request became unfulfillable". It is the
-- table-wide predicate 'no paid refresh anywhere is holding money for work it can never do' —
-- derived from `private.analysis_authorized` at test time over every row in the table, so a future
-- path that strands a request in some way this file never imagined fails it too.
--
-- On d6ae268 the named failing assertions are 'the stranded request reached a terminal state'
-- (it reads `paid`), 'no paid refresh anywhere is holding money for work that can never be done'
-- (one row comes back), and 'the replay reports the terminal state instead of a flat refusal'
-- (`paid_refresh_analysis_authorization` does not exist there at all).

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(25);

-- =============================================================================================
-- Two clients whose analysis authority is real: active enrollment, active subscription, consent
-- =============================================================================================

insert into auth.users (id, email) values
  ('37700000-0000-4000-8000-000000000011', 'r5c01-consumer-a@test.example'),
  ('37700000-0000-4000-8000-000000000012', 'r5c01-consumer-b@test.example');
insert into public.orgs (id, name, slug)
values ('37700000-0000-4000-8000-000000000001', 'R5C01 Org', 'r5c01-org');
insert into public.profiles (id, role, org_id, full_name, email) values
  ('37700000-0000-4000-8000-000000000011', 'consumer', '37700000-0000-4000-8000-000000000001',
   'R5C01 Consumer A', 'r5c01-consumer-a@test.example'),
  ('37700000-0000-4000-8000-000000000012', 'consumer', '37700000-0000-4000-8000-000000000001',
   'R5C01 Consumer B', 'r5c01-consumer-b@test.example')
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, full_name = excluded.full_name;
insert into public.clients (id, org_id, consumer_profile_id, display_name) values
  ('37700000-0000-4000-8000-000000000101', '37700000-0000-4000-8000-000000000001',
   '37700000-0000-4000-8000-000000000011', 'R5C01 Client A'),
  ('37700000-0000-4000-8000-000000000102', '37700000-0000-4000-8000-000000000001',
   '37700000-0000-4000-8000-000000000012', 'R5C01 Client B');
insert into public.consents (id, client_id, kind, action, text_version, signed_at, ip, esig_ref)
values
  ('37700000-0000-4000-8000-000000000311', '37700000-0000-4000-8000-000000000101',
   'monitoring', 'granted', 'v1', '2026-08-01T00:00:00Z', '127.0.0.1', 'esig:r5c01:a'),
  ('37700000-0000-4000-8000-000000000301', '37700000-0000-4000-8000-000000000101',
   'analysis', 'granted', 'v1', '2026-08-01T00:00:00Z', '127.0.0.1', 'esig:r5c01:a'),
  ('37700000-0000-4000-8000-000000000312', '37700000-0000-4000-8000-000000000102',
   'monitoring', 'granted', 'v1', '2026-08-01T00:00:00Z', '127.0.0.1', 'esig:r5c01:b'),
  ('37700000-0000-4000-8000-000000000302', '37700000-0000-4000-8000-000000000102',
   'analysis', 'granted', 'v1', '2026-08-01T00:00:00Z', '127.0.0.1', 'esig:r5c01:b');
insert into public.enrollments (
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values
  ('37700000-0000-4000-8000-000000000201', '37700000-0000-4000-8000-000000000101', 'active',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'esig:r5c01:a'),
  ('37700000-0000-4000-8000-000000000202', '37700000-0000-4000-8000-000000000102', 'active',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'esig:r5c01:b');
insert into public.consumer_subscriptions (
  client_id, enrollment_id, provider, customer_ref, subscription_ref,
  price_cents, status, idempotency_key
) values
  ('37700000-0000-4000-8000-000000000101', '37700000-0000-4000-8000-000000000201',
   'mock', 'cus_r5c01_a', 'sub_r5c01_a', 4900, 'active', 'sub:r5c01:a'),
  ('37700000-0000-4000-8000-000000000102', '37700000-0000-4000-8000-000000000202',
   'mock', 'cus_r5c01_b', 'sub_r5c01_b', 4900, 'active', 'sub:r5c01:b');
select ok(
  private.analysis_authorized('37700000-0000-4000-8000-000000000101'),
  'the client starts with a real analysis authority, so nothing below is vacuous'
);

-- =============================================================================================
-- The money moves, exactly as it does in the reproduction
-- =============================================================================================

create temporary table r5c01_a on commit drop as
select id from public.create_paid_refresh_request(
  '37700000-0000-4000-8000-000000000011', '37700000-0000-4000-8000-000000000101',
  'r5c01-request-a', 1900, 'usd', 'mock'
);
select allowed from public.reserve_paid_refresh_pull(
  '37700000-0000-4000-8000-000000000101', (select id from r5c01_a), 900
);
select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
  (select id from r5c01_a), 'force_pull:r5c01:a'
);
select payment_attempt_state from public.record_paid_refresh_provider_returned(
  (select id from r5c01_a), 'force_pull:r5c01:a',
  'mock:event:r5c01:a', 'mock:payment:r5c01:a', 'succeeded', 1900, 'usd'
);
select outcome from public.record_paid_refresh_payment_event(
  (select id from r5c01_a), 'mock:event:r5c01:a',
  'mock:payment:r5c01:a', 'succeeded', 1900, 'usd'
);

select is(
  (select state from public.paid_refresh_requests where id = (select id from r5c01_a)),
  'paid', 'the charge lands and the request is paid with nothing queued against it'
);

-- A failed enqueue with the authority still intact is the rediscovery class, not this one. It must
-- stay retryable, so the inline resolver re-derives rather than trusting the caller.
select is(
  public.resolve_paid_refresh_unfulfillable((select id from r5c01_a)),
  false,
  'a transient enqueue failure with the authority intact leaves the request paid and retryable'
);

-- =============================================================================================
-- The authority disappears inside the interval
-- =============================================================================================

insert into public.consent_revocations (consent_id, client_id, kind, revoked_at)
values (
  '37700000-0000-4000-8000-000000000301', '37700000-0000-4000-8000-000000000101',
  'analysis', now()
);

-- Fails on d6ae268: reads `paid`, because there is no terminal state to reach.
select is(
  (select state from public.paid_refresh_requests where id = (select id from r5c01_a)),
  'unfulfillable', 'the stranded request reached a terminal state'
);

-- Terminality has to be a property of the state, not a convention the callers observe.
select throws_ok(
  format(
    $$select * from public.link_paid_refresh_analysis(%L, '37700000-0000-4000-8000-000000000999')$$,
    (select id from r5c01_a)
  ),
  '22023', 'PAID_REFRESH_ANALYSIS_INVALID',
  'no analysis run can be linked to a request in the terminal state'
);
-- The payment machine is the other way back in. A replayed provider event still answers
-- idempotently, which is right, but it must not carry the request out of the terminal state.
select outcome from public.record_paid_refresh_payment_event(
  (select id from r5c01_a), 'mock:event:r5c01:a',
  'mock:payment:r5c01:a', 'succeeded', 1900, 'usd'
);
select throws_ok(
  format(
    $$select * from public.record_paid_refresh_payment_event(
        %L, 'mock:event:r5c01:a:later', 'mock:payment:r5c01:a:later', 'succeeded', 1900, 'usd'
      )$$,
    (select id from r5c01_a)
  ),
  '22023', 'PAID_REFRESH_PROVIDER_RESULT_REPLAY_MISMATCH',
  'a new provider payment cannot attach itself to the terminal request'
);
select is(
  (select state from public.paid_refresh_requests where id = (select id from r5c01_a)),
  'unfulfillable',
  'and neither the replayed event nor the rejected one moved it back out'
);

-- =============================================================================================
-- The obligation, and the pieces an operator needs to discharge it
-- =============================================================================================

select results_eq(
  format(
    $$select org_id::text, amount_cents, currency, provider_payment_ref, reason, state,
             resolved_at is null
      from public.paid_refresh_remediations where request_id = %L$$,
    (select id from r5c01_a)
  ),
  $$ values (
    '37700000-0000-4000-8000-000000000001'::text, 1900, 'usd'::text,
    'mock:payment:r5c01:a'::text, 'analysis_authorization_withdrawn'::text, 'open'::text, true
  ) $$,
  'an open obligation carries the org, the amount and the payment reference a refund needs'
);

select is(
  (select count(*)::int from public.pull_cap_attempts
   where cause = 'force_pull' and source_id = (select id from r5c01_a)
     and reservation_state = 'reserved'),
  0, 'the capacity the request reserved went back, because no pull is coming'
);

select isnt_empty(
  format(
    $$select id from public.audit_log
      where subject_type = 'paid_refresh_request' and subject_id = %L
        and action = 'paid_refresh.transition' and meta ->> 'to_state' = 'unfulfillable'$$,
    (select id from r5c01_a)
  ),
  'the transition is on the audit trail like every other paid-refresh transition'
);

-- Fails on d6ae268: the function does not exist, and the read it replaced returned a bare refusal
-- with no way for the caller to learn the request had been terminalized.
select results_eq(
  $$select authorized, unfulfillable_request_id::text
    from public.paid_refresh_analysis_authorization(
      '37700000-0000-4000-8000-000000000101',
      '37700000-0000-4000-8000-000000000011',
      'r5c01-request-a'
    )$$,
  format($$ values (false, %L::text) $$, (select id from r5c01_a)),
  'the replay reports the terminal state instead of a flat refusal'
);

-- =============================================================================================
-- The other authority: an enrollment reaching cancelled strands the same way
-- =============================================================================================

create temporary table r5c01_b on commit drop as
select id from public.create_paid_refresh_request(
  '37700000-0000-4000-8000-000000000012', '37700000-0000-4000-8000-000000000102',
  'r5c01-request-b', 1900, 'usd', 'mock'
);
select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
  (select id from r5c01_b), 'force_pull:r5c01:b'
);
select payment_attempt_state from public.record_paid_refresh_provider_returned(
  (select id from r5c01_b), 'force_pull:r5c01:b',
  'mock:event:r5c01:b', 'mock:payment:r5c01:b', 'succeeded', 1900, 'usd'
);
select outcome from public.record_paid_refresh_payment_event(
  (select id from r5c01_b), 'mock:event:r5c01:b',
  'mock:payment:r5c01:b', 'succeeded', 1900, 'usd'
);

update public.enrollments set status = 'cancelled'
where id = '37700000-0000-4000-8000-000000000202';

select results_eq(
  format(
    $$select request.state, remediation.reason
      from public.paid_refresh_requests as request
      join public.paid_refresh_remediations as remediation on remediation.request_id = request.id
      where request.id = %L$$,
    (select id from r5c01_b)
  ),
  $$ values ('unfulfillable'::text, 'enrollment_cancelled'::text) $$,
  'a cancelled enrollment strands its paid refreshes the same way and says which authority went'
);

-- =============================================================================================
-- The property, over the whole table rather than the two rows this file created
-- =============================================================================================

-- Fails on d6ae268: client A's request comes back.
select is_empty(
  $$
    select request.id::text
    from public.paid_refresh_requests as request
    where request.state = 'paid'
      and request.analysis_run_id is null
      and not private.analysis_authorized(request.client_id)
  $$,
  'no paid refresh anywhere is holding money for work that can never be done'
);

-- And every terminal request has an obligation attached — again derived, over the whole table.
select is_empty(
  $$
    select request.id::text
    from public.paid_refresh_requests as request
    where request.state = 'unfulfillable'
      and not exists (
        select 1 from public.paid_refresh_remediations as remediation
        where remediation.request_id = request.id
      )
  $$,
  'every terminal request has an operator obligation recorded against it'
);

-- =============================================================================================
-- The obligation record is closed vocabulary, and it can be discharged
-- =============================================================================================

-- The reason vocabulary is read off the constraint, so the refusal below cannot become vacuous by
-- the allow-list widening under it: the value it offers is built out of the list the constraint
-- actually declares and so can never be a member of it.
create temporary table r5c01_reasons on commit drop as
select literal[1]::text as value
from pg_catalog.pg_constraint as con
cross join lateral pg_catalog.regexp_matches(
  pg_catalog.pg_get_constraintdef(con.oid), $re$'([a-z_]+)'$re$, 'g'
) as literal
where con.conrelid = 'public.paid_refresh_remediations'::regclass
  and con.conname = 'paid_refresh_remediations_reason_closed';

select cmp_ok(
  (select count(*)::int from r5c01_reasons), '>', 0,
  'the reason vocabulary was actually read off the constraint'
);

select throws_ok(
  format(
    $$insert into public.paid_refresh_remediations (
        request_id, client_id, org_id, amount_cents, currency, provider_payment_ref, reason
      ) values (
        %L, '37700000-0000-4000-8000-000000000102',
        '37700000-0000-4000-8000-000000000001', 1900, 'usd', 'mock:payment:free-text', %L
      )$$,
    (select id from r5c01_b),
    (select 'not_' || string_agg(value, '_') from r5c01_reasons)
  ),
  '23514', null,
  'a reason the constraint does not declare cannot be written into the obligation record'
);

select is(
  public.close_paid_refresh_remediation(
    (select id from r5c01_a), '37700000-0000-4000-8000-000000000011', 'refunded'
  ),
  true, 'an operator can discharge the obligation and the disposition is recorded'
);
select is(
  public.close_paid_refresh_remediation(
    (select id from r5c01_a), '37700000-0000-4000-8000-000000000011', 'refunded'
  ),
  false, 'and discharging it twice is a no-op rather than a second resolution'
);

-- =============================================================================================
-- The sweep binds the owner too — derived from the catalog, not from the two names above
-- =============================================================================================

select is_empty(
  $$
    select trigger.tgname::text
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_proc as fn on fn.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as ns on ns.oid = fn.pronamespace
    where ns.nspname = 'private'
      and fn.proname = 'sweep_unfulfillable_paid_refreshes'
      and trigger.tgenabled <> 'A'
  $$,
  'every trigger that runs the sweep fires ALWAYS, so the table owner cannot slip past it'
);

-- =============================================================================================
-- The obligation record takes the treatment 374's boundary gives every governed record
-- =============================================================================================

select results_eq(
  $$select relrowsecurity, relforcerowsecurity
    from pg_catalog.pg_class where oid = 'public.paid_refresh_remediations'::regclass$$,
  $$ values (true, true) $$,
  'row security is enabled and forced on the obligation record'
);
select table_privs_are(
  'public', 'paid_refresh_remediations', 'service_role', array['SELECT'],
  'service_role can read the obligation and nothing more'
);
select table_privs_are(
  'public', 'paid_refresh_remediations', 'authenticated', array[]::text[],
  'an authenticated session holds no privilege on it at all'
);
select table_privs_are(
  'public', 'paid_refresh_remediations', 'anon', array[]::text[],
  'and neither does an anonymous one'
);
select isnt_empty(
  $$select table_name from private.erasure_boundary_tables()
    where table_name = 'paid_refresh_remediations'$$,
  'the obligation is inside the erasure boundary, so an operator debt cannot be quietly deleted'
);
select throws_ok(
  $$truncate table public.paid_refresh_remediations$$,
  '42501', null,
  'and it cannot be truncated away either'
);

select * from finish();
rollback;
