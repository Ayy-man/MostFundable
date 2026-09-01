begin;

set local search_path = public, extensions;

select plan(38);

select has_index(
  'public', 'paid_refresh_requests', 'paid_refresh_one_open_stripe_payment_idx',
  'Stripe has a physical one-open-payment backstop'
);

select has_function(
  'private', 'paid_refresh_purchase_is_blocked', array['uuid', 'text', 'uuid'],
  'the unresolved-purchase predicate is centralized'
);
select ok(
  not has_function_privilege(
    'service_role', 'private.paid_refresh_purchase_is_blocked(uuid,text,uuid)', 'execute'
  ),
  'the service role cannot bypass the public transition RPCs'
);
select ok(
  has_function_privilege(
    'service_role', 'public.create_paid_refresh_request(uuid,uuid,text,integer,text,text)', 'execute'
  ) and has_function_privilege(
    'service_role', 'public.begin_paid_refresh_payment_attempt(uuid,text)', 'execute'
  ),
  'the service role retains the two governed transitions'
);
select has_function(
  'public', 'consumer_paid_refresh_history', array['uuid', 'boolean'],
  'consumer refresh history has one dual-authority boundary with a default-safe fixture flag'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.consumer_paid_refresh_history(uuid,boolean)', 'execute'
  ) and has_function_privilege(
    'service_role', 'public.consumer_paid_refresh_history(uuid,boolean)', 'execute'
  ) and not has_function_privilege(
    'anon', 'public.consumer_paid_refresh_history(uuid,boolean)', 'execute'
  ),
  'only authenticated and the server service role can execute the history reader'
);

insert into auth.users (id, email) values
  ('43100000-0000-4000-8000-000000000011', 'a@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000012', 'b@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000013', 'c@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000014', 'd@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000015', 'e@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000016', 'f@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000019', 'operator@paid-refresh-431.test');

insert into public.orgs (id, name, slug)
values ('43100000-0000-4000-8000-000000000001', 'Paid Refresh 431', 'paid-refresh-431');

insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('43100000-0000-4000-8000-000000000011', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer A', 'a@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000012', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer B', 'b@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000013', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer C', 'c@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000014', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer D', 'd@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000015', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer E', 'e@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000016', 'consumer', '43100000-0000-4000-8000-000000000001', null, 'Consumer F', 'f@paid-refresh-431.test'),
  ('43100000-0000-4000-8000-000000000019', 'operator_member', '43100000-0000-4000-8000-000000000001', 'owner', 'Operator', 'operator@paid-refresh-431.test')
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, assigned_to, display_name) values
  ('43100000-0000-4000-8000-000000000101', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000019', 'Client A'),
  ('43100000-0000-4000-8000-000000000102', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000012', '43100000-0000-4000-8000-000000000019', 'Client B'),
  ('43100000-0000-4000-8000-000000000103', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000013', '43100000-0000-4000-8000-000000000019', 'Client C'),
  ('43100000-0000-4000-8000-000000000104', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000014', '43100000-0000-4000-8000-000000000019', 'Client D'),
  ('43100000-0000-4000-8000-000000000105', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000015', '43100000-0000-4000-8000-000000000019', 'Client E'),
  ('43100000-0000-4000-8000-000000000106', '43100000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000016', '43100000-0000-4000-8000-000000000019', 'Client F');

-- A historical mock row is invisible in production and cannot lock a later
-- Stripe cutover. The first Stripe request blocks from the moment it exists.
create temporary table request_a0 on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
  'request-a0', 1900, 'usd', 'mock'
);
create temporary table request_a1 on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
  'request-a1', 1900, 'usd', 'stripe'
);
select isnt((select id from request_a0), null::uuid, 'a historical mock request is created');
select isnt((select id from request_a1), null::uuid, 'the first unstarted request is created');
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
    'request-a2', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'a second key is blocked immediately after request creation'
);
select is(
  (select payment_attempt_state from public.begin_paid_refresh_payment_attempt(
    (select id from request_a1), 'force_pull:request-a1'
  )),
  'dispatching', 'one request enters provider dispatch'
);
select is(
  (select id from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
    'request-a1', 1900, 'usd', 'stripe'
  )),
  (select id from request_a1),
  'the exact key still replays while its request is outstanding'
);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
    'request-a3', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'a new key cannot create beside a dispatching payment'
);
select ok(
  public.mark_paid_refresh_payment_needs_review(
    (select id from request_a1), 'force_pull:request-a1'
  ),
  'the dispatch can enter review'
);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000011', '43100000-0000-4000-8000-000000000101',
    'request-a4', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'payment review remains blocking across a reload and new key'
);

create temporary table request_b on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000012', '43100000-0000-4000-8000-000000000102',
  'request-b1', 1900, 'usd', 'stripe'
);
update public.paid_refresh_requests
set state = 'requires_action', provider_payment_ref = 'pi_b'
where id = (select id from request_b);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000012', '43100000-0000-4000-8000-000000000102',
    'request-b2', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'action-required payment blocks another purchase'
);

create temporary table request_c on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000013', '43100000-0000-4000-8000-000000000103',
  'request-c1', 1900, 'usd', 'stripe'
);
update public.paid_refresh_requests
set state = 'paid', provider_payment_ref = 'pi_c'
where id = (select id from request_c);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000013', '43100000-0000-4000-8000-000000000103',
    'request-c2', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'paid work that is not yet linked blocks another purchase'
);

create temporary table request_d on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000014', '43100000-0000-4000-8000-000000000104',
  'request-d1', 1900, 'usd', 'stripe'
);
create temporary table job_d (id uuid, analysis_run_id uuid) on commit drop;
with inserted_job as (
  insert into public.analysis_jobs (client_id, source_kind, source_id, trigger)
  values (
    '43100000-0000-4000-8000-000000000104', 'force_pull',
    (select id from request_d), 'force_pull'
  )
  returning id, analysis_run_id
)
insert into job_d select id, analysis_run_id from inserted_job;
update public.paid_refresh_requests
set state = 'queued', provider_payment_ref = 'pi_d',
    analysis_run_id = (select analysis_run_id from job_d)
where id = (select id from request_d);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000014', '43100000-0000-4000-8000-000000000104',
    'request-d2', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'queued analysis blocks another purchase'
);
update public.analysis_jobs set status = 'running' where id = (select id from job_d);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000014', '43100000-0000-4000-8000-000000000104',
    'request-d3', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'running analysis blocks another purchase'
);
update public.analysis_jobs
set status = 'failed', error_code = 'pull_failed'
where id = (select id from job_d);
select lives_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000014', '43100000-0000-4000-8000-000000000104',
    'request-d4', 1900, 'usd', 'stripe'
  )$$,
  'a terminal failed analysis releases the duplicate-purchase guard'
);

create temporary table request_e on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000015', '43100000-0000-4000-8000-000000000105',
  'request-e1', 1900, 'usd', 'stripe'
);
update public.paid_refresh_requests
set state = 'unfulfillable', provider_payment_ref = 'pi_e'
where id = (select id from request_e);
insert into public.paid_refresh_remediations (
  request_id, client_id, org_id, amount_cents, currency, provider_payment_ref, reason
) values (
  (select id from request_e), '43100000-0000-4000-8000-000000000105',
  '43100000-0000-4000-8000-000000000001', 1900, 'usd', 'pi_e',
  'analysis_authorization_withdrawn'
);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000015', '43100000-0000-4000-8000-000000000105',
    'request-e2', 1900, 'usd', 'stripe'
  )$$,
  '55000', 'PAID_REFRESH_OUTSTANDING_REQUEST',
  'an open unfulfillable obligation blocks another purchase'
);
select ok(
  public.close_paid_refresh_remediation(
    (select id from request_e), '43100000-0000-4000-8000-000000000019', 'refunded'
  ),
  'support can resolve the paid obligation'
);
select lives_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000015', '43100000-0000-4000-8000-000000000105',
    'request-e3', 1900, 'usd', 'stripe'
  )$$,
  'a resolved unfulfillable obligation no longer blocks a purchase'
);

create temporary table request_f on commit drop as
select id from public.create_paid_refresh_request(
  '43100000-0000-4000-8000-000000000016', '43100000-0000-4000-8000-000000000106',
  'request-f1', 1900, 'usd', 'stripe'
);
update public.paid_refresh_requests
set state = 'payment_failed', provider_payment_ref = 'pi_f'
where id = (select id from request_f);
select lives_ok(
  $$select * from public.create_paid_refresh_request(
    '43100000-0000-4000-8000-000000000016', '43100000-0000-4000-8000-000000000106',
    'request-f2', 1900, 'usd', 'stripe'
  )$$,
  'a terminal failed payment permits a later purchase'
);

select is(
  (select count(*)::integer from public.paid_refresh_requests
   where client_id = '43100000-0000-4000-8000-000000000101'
     and payment_attempt_state in ('dispatching', 'provider_returned', 'needs_review')),
  1,
  'only one provider attempt is outstanding for the raced client'
);
select is(
  (select count(*)::integer from public.paid_refresh_requests
   where actor_profile_id = '43100000-0000-4000-8000-000000000011'
     and idempotency_key = 'request-a1'),
  1,
  'exact replay keeps one durable request identity'
);

-- The assertions below run as the real authenticated role. Grant that role
-- access only to the temporary id handles used for cross-scope comparisons.
grant select on request_a1, request_b, request_d to authenticated;

set local request.jwt.claims = '{"role":"authenticated","sub":"43100000-0000-4000-8000-000000000011"}';
set local role authenticated;

select is(
  (select count(*)::integer from public.consumer_paid_refresh_history()),
  1,
  'the consumer reads only their real-driver request through the status projection'
);
select is(
  (select count(*)::integer from public.consumer_paid_refresh_history(null, true)),
  1,
  'a consumer cannot expose fixture history by setting the public argument alone'
);
select is(
  (select count(*)::integer
   from public.consumer_paid_refresh_history()
   where request_id = (select id from request_b)),
  0,
  'the self-scoped reader cannot return another consumer request'
);
select is(
  (select status
   from public.consumer_paid_refresh_history()
   where request_id = (select id from request_a1)),
  'payment_review',
  'the projection preserves the durable provider-review status'
);
select throws_ok(
  $$select * from public.consumer_paid_refresh_history(
    '43100000-0000-4000-8000-000000000012', false
  )$$,
  '42501', 'PAID_REFRESH_HISTORY_FORBIDDEN',
  'an authenticated consumer cannot supply or substitute an actor identity'
);
select is(
  (
    select pg_catalog.array_agg(key order by key)::text
    from (
      select * from public.consumer_paid_refresh_history() limit 1
    ) as history
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(history)) as key
  ),
  '{amount_cents,completed_at,currency,paid_at,request_id,requested_at,status}',
  'the authenticated result exposes only the closed provider-free status columns and no driver discriminator'
);

reset role;
set local request.jwt.claims = '{"role":"authenticated","sub":"43100000-0000-4000-8000-000000000011","app_metadata":{"paid_refresh_mock_history":true}}';
set local role authenticated;
select is(
  (select count(*)::integer from public.consumer_paid_refresh_history(null, true)),
  2,
  'a server-controlled fixture claim restores deterministic mock history outside production'
);

reset role;
insert into public.analysis_runs (id, client_id, trigger, readiness_score, derived)
select
  analysis_run_id,
  '43100000-0000-4000-8000-000000000104',
  'force_pull',
  0,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'bureausPulled', pg_catalog.jsonb_build_array('EQF'),
    'accounts', '[]'::jsonb,
    'overallUtilizationPct', null,
    'inquiriesByBureau', pg_catalog.jsonb_build_object('EQF', 0, 'EXP', 0, 'TUC', 0),
    'negativesCount', 0,
    'openRevolvingCount', 0,
    'averageAgeMonths', null,
    'highestRevolvingLimitCents', null,
    'dti', pg_catalog.jsonb_build_object(
      'monthlyDebtPaymentsCents', 0,
      'statedMonthlyIncomeCents', null,
      'ratioPct', null
    ),
    'flags', pg_catalog.jsonb_build_object(
      'averageAgeTwoYearsOrMore', false,
      'cardWithTenKLimit', false,
      'fourOrMorePersonalAccountsOpen', false,
      'noNegativeItemsReported', true,
      'thinFile', true,
      'twoOrFewerInquiriesEveryBureau', true,
      'utilizationUnder30', true
    ),
    'computedAt', '2026-09-01T00:00:00.000Z'
  )
from job_d;
update public.analysis_jobs
set status = 'succeeded'
where id = (select id from job_d);
set local request.jwt.claims = '{"role":"authenticated","sub":"43100000-0000-4000-8000-000000000014"}';
set local role authenticated;
select is(
  (select completed_at
   from public.consumer_paid_refresh_history()
   where request_id = (select id from request_d)),
  null::timestamptz,
  'an analysis run without immutable successful payment evidence has no completion timestamp'
);

reset role;
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select is(
  (select count(*)::integer from public.consumer_paid_refresh_history(
    '43100000-0000-4000-8000-000000000011', true
  )),
  2,
  'the server-only demo authority receives the same scoped projection including fixture history'
);
select throws_ok(
  $$select * from public.consumer_paid_refresh_history()$$,
  '42501', 'PAID_REFRESH_HISTORY_FORBIDDEN',
  'the service role cannot read history without naming its resolved actor'
);
select throws_ok(
  $$select * from public.consumer_paid_refresh_history(
    '43100000-0000-4000-8000-000000000019', false
  )$$,
  '42501', 'PAID_REFRESH_HISTORY_FORBIDDEN',
  'the service role cannot project history for an operator'
);

reset role;
update public.profiles
set disabled_at = pg_catalog.clock_timestamp()
where id = '43100000-0000-4000-8000-000000000012';
set local role service_role;
select throws_ok(
  $$select * from public.consumer_paid_refresh_history(
    '43100000-0000-4000-8000-000000000012', false
  )$$,
  '42501', 'PAID_REFRESH_HISTORY_FORBIDDEN',
  'the service role cannot project history for a disabled consumer'
);

reset role;
set local request.jwt.claims = '{"role":"authenticated","sub":"43100000-0000-4000-8000-000000000019"}';
set local role authenticated;
select throws_ok(
  $$select * from public.consumer_paid_refresh_history()$$,
  '42501', 'PAID_REFRESH_HISTORY_FORBIDDEN',
  'an operator cannot use the consumer history definer'
);

reset role;
reset request.jwt.claims;

select * from finish();
rollback;
