begin;

set local search_path = public, extensions;

select plan(55);

select has_table('public', 'paid_refresh_requests', 'paid refresh request table exists');
select has_table('public', 'paid_refresh_payment_events', 'paid refresh event table exists');

-- 2026-08-17 R2C-05 carry: bounded outbound-attempt metadata is durable on the request.
select results_eq(
  $$select column_name::text collate "C" from information_schema.columns
    where table_schema = 'public' and table_name = 'paid_refresh_requests'
    order by ordinal_position$$,
  $$values
    ('id'::text collate "C"), ('actor_profile_id'::text collate "C"),
    ('client_id'::text collate "C"), ('org_id'::text collate "C"),
    ('idempotency_key'::text collate "C"), ('amount_cents'::text collate "C"),
    ('currency'::text collate "C"), ('driver'::text collate "C"),
    ('state'::text collate "C"), ('provider_payment_ref'::text collate "C"),
    ('analysis_run_id'::text collate "C"), ('created_at'::text collate "C"),
    ('updated_at'::text collate "C"), ('payment_attempt_state'::text collate "C"),
    ('payment_idempotency_key'::text collate "C"), ('payment_dispatch_started_at'::text collate "C"),
    ('payment_provider_event_key'::text collate "C"), ('payment_provider_payment_ref'::text collate "C"),
    ('payment_provider_outcome'::text collate "C"), ('payment_provider_returned_at'::text collate "C")$$,
  'request ledger exposes only bounded workflow metadata'
);

select results_eq(
  $$select column_name::text collate "C" from information_schema.columns
    where table_schema = 'public' and table_name = 'paid_refresh_payment_events'
    order by ordinal_position$$,
  $$values
    ('id'::text collate "C"), ('request_id'::text collate "C"),
    ('provider_event_key'::text collate "C"), ('provider_payment_ref'::text collate "C"),
    ('outcome'::text collate "C"), ('amount_cents'::text collate "C"),
    ('currency'::text collate "C"), ('occurred_at'::text collate "C")$$,
  'event ledger exposes only bounded payment evidence'
);

select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
   where oid in ('public.paid_refresh_requests'::regclass, 'public.paid_refresh_payment_events'::regclass)),
  true,
  'both paid refresh tables enable and force row security'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename in ('paid_refresh_requests', 'paid_refresh_payment_events')),
  0,
  'paid refresh tables expose no browser policy'
);
select is(has_table_privilege('service_role', 'public.paid_refresh_requests', 'select'), true, 'service role can read request evidence');
select is(has_table_privilege('service_role', 'public.paid_refresh_payment_events', 'select'), true, 'service role can read event evidence');
select ok(
  not has_table_privilege('service_role', 'public.paid_refresh_requests', 'insert,update,delete')
    and not has_table_privilege('service_role', 'public.paid_refresh_payment_events', 'insert,update,delete'),
  'service role writes only through transition RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.paid_refresh_requests', 'select')
    and not has_table_privilege('authenticated', 'public.paid_refresh_payment_events', 'select'),
  'authenticated users cannot read either ledger directly'
);
select is(
  (select bool_and(prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""'])
   from pg_proc where oid in (
     'public.create_paid_refresh_request(uuid,uuid,text,integer,text,text)'::regprocedure,
     'public.record_paid_refresh_payment_event(uuid,text,text,text,integer,text)'::regprocedure,
     'public.read_paid_refresh_request(uuid)'::regprocedure,
     'public.link_paid_refresh_analysis(uuid,uuid)'::regprocedure
   )),
  true,
  'all paid refresh RPCs are fixed-path security definers'
);
select ok(
  has_function_privilege('service_role', 'public.create_paid_refresh_request(uuid,uuid,text,integer,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.record_paid_refresh_payment_event(uuid,text,text,text,integer,text)', 'execute')
    and has_function_privilege('service_role', 'public.read_paid_refresh_request(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.link_paid_refresh_analysis(uuid,uuid)', 'execute'),
  'service role can execute every paid refresh RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_paid_refresh_request(uuid,uuid,text,integer,text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.record_paid_refresh_payment_event(uuid,text,text,text,integer,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.read_paid_refresh_request(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.link_paid_refresh_analysis(uuid,uuid)', 'execute'),
  'authenticated users cannot execute paid refresh transitions'
);
select has_trigger(
  'public', 'paid_refresh_payment_events', 'paid_refresh_payment_events_immutable',
  'payment evidence has an append-only trigger'
);
select is(
  (select count(*)::integer from pg_indexes where schemaname = 'public'
   and indexname in (
     'paid_refresh_requests_actor_key_unique',
     'paid_refresh_requests_client_created_idx',
     'paid_refresh_events_one_success_per_request',
     'paid_refresh_events_request_occurred_idx'
   )),
  4,
  'request idempotency and event lookup indexes exist'
);

insert into auth.users (id, email)
values
  ('81000000-0000-4000-8000-000000000011', 'consumer-a@paid-refresh.test'),
  ('81000000-0000-4000-8000-000000000012', 'consumer-b@paid-refresh.test'),
  ('81000000-0000-4000-8000-000000000013', 'operator@paid-refresh.test');

insert into public.orgs (id, name, slug)
values ('81000000-0000-4000-8000-000000000001', 'Paid Refresh Org', 'paid-refresh-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  ('81000000-0000-4000-8000-000000000011', 'consumer', '81000000-0000-4000-8000-000000000001', null, 'Consumer A', 'consumer-a@paid-refresh.test'),
  ('81000000-0000-4000-8000-000000000012', 'consumer', '81000000-0000-4000-8000-000000000001', null, 'Consumer B', 'consumer-b@paid-refresh.test'),
  ('81000000-0000-4000-8000-000000000013', 'operator_member', '81000000-0000-4000-8000-000000000001', 'owner', 'Operator', 'operator@paid-refresh.test')
on conflict (id) do update set
  role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role,
  full_name = excluded.full_name, email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, assigned_to, display_name)
values
  ('81000000-0000-4000-8000-000000000101', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011', '81000000-0000-4000-8000-000000000013', 'Paid Refresh Client A'),
  ('81000000-0000-4000-8000-000000000102', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000012', '81000000-0000-4000-8000-000000000013', 'Paid Refresh Client B');

-- 2026-08-17 R1D-02 carry: paid refresh requires current analysis authorization.
insert into public.consents(id,client_id,kind,text_version,signed_at,ip,esig_ref) values
  ('81000000-0000-4000-8000-000000000111','81000000-0000-4000-8000-000000000101','monitoring','v1','2026-08-17','127.0.0.1','paid-refresh-a'),
  ('81000000-0000-4000-8000-000000000112','81000000-0000-4000-8000-000000000101','analysis','v1','2026-08-17','127.0.0.1','paid-refresh-a'),
  ('81000000-0000-4000-8000-000000000121','81000000-0000-4000-8000-000000000102','monitoring','v1','2026-08-17','127.0.0.1','paid-refresh-b'),
  ('81000000-0000-4000-8000-000000000122','81000000-0000-4000-8000-000000000102','analysis','v1','2026-08-17','127.0.0.1','paid-refresh-b');
insert into public.enrollments(id,client_id,status,esig_doc_id,monitoring_consent_at,analysis_consent_at) values
  ('81000000-0000-4000-8000-000000000131','81000000-0000-4000-8000-000000000101','active','paid-refresh-a','2026-08-17','2026-08-17'),
  ('81000000-0000-4000-8000-000000000132','81000000-0000-4000-8000-000000000102','active','paid-refresh-b','2026-08-17','2026-08-17');
-- 2026-08-17 R3C-03: paid-refresh source tests require current paid access so
-- their negative cases continue to reach source validation.
insert into public.consumer_subscriptions(
  id,client_id,enrollment_id,provider,customer_ref,subscription_ref,price_cents,status,idempotency_key
) values
  ('81000000-0000-4000-8000-000000000141','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000131','mock','mock_paid_refresh_a','mock_paid_refresh_sub_a',1900,'active','paid-refresh-active-a'),
  ('81000000-0000-4000-8000-000000000142','81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000132','mock','mock_paid_refresh_b','mock_paid_refresh_sub_b',1900,'active','paid-refresh-active-b');

create temporary table paid_refresh_fixture as
select id as request_id
from public.create_paid_refresh_request(
  '81000000-0000-4000-8000-000000000011',
  '81000000-0000-4000-8000-000000000101',
  '81000000-0000-4000-8000-000000000201',
  1900, 'usd', 'mock'
);

select is(
  (select state from public.paid_refresh_requests where id = (select request_id from paid_refresh_fixture)),
  'initiated',
  'request starts in initiated state'
);
select is((select count(*)::integer from public.paid_refresh_requests), 1, 'one local request is persisted');
select is(
  (select id from public.create_paid_refresh_request(
    '81000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000101',
    '81000000-0000-4000-8000-000000000201',
    1900, 'usd', 'mock'
  )),
  (select request_id from paid_refresh_fixture),
  'exact request replay returns the original id'
);
select is((select count(*)::integer from public.paid_refresh_requests), 1, 'request replay creates no duplicate');
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '81000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000101',
    '81000000-0000-4000-8000-000000000201',
    2000, 'usd', 'mock'
  )$$,
  '22023', 'PAID_REFRESH_REPLAY_MISMATCH',
  'request replay rejects immutable amount drift'
);
select throws_ok(
  $$select * from public.create_paid_refresh_request(
    '81000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000101',
    '81000000-0000-4000-8000-000000000202',
    1900, 'usd', 'mock'
  )$$,
  '42501', 'PAID_REFRESH_SCOPE_INVALID',
  'request creation rejects a consumer outside the client scope'
);
select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '81000000-0000-4000-8000-000000000101', 'force_pull',
    (select request_id from paid_refresh_fixture), 'force_pull'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'an unpaid request cannot enqueue analysis'
);

select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select request_id from paid_refresh_fixture),
    'mock:failed:81000000-0000-4000-8000-000000000201',
    'mock_pi_81000000_0000_4000_8000_000000000201',
    'failed', 1900, 'usd'
  )),
  'failed',
  'a failed payment outcome is persisted'
);
select is(
  (select state from public.paid_refresh_requests where id = (select request_id from paid_refresh_fixture)),
  'payment_failed',
  'failed payment advances only to payment_failed'
);
select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '81000000-0000-4000-8000-000000000101', 'force_pull',
    (select request_id from paid_refresh_fixture), 'force_pull'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'a failed payment cannot enqueue analysis'
);
select is(
  (select id from public.record_paid_refresh_payment_event(
    (select request_id from paid_refresh_fixture),
    'mock:failed:81000000-0000-4000-8000-000000000201',
    'mock_pi_81000000_0000_4000_8000_000000000201',
    'failed', 1900, 'usd'
  )),
  (select id from public.paid_refresh_payment_events where provider_event_key = 'mock:failed:81000000-0000-4000-8000-000000000201'),
  'event replay returns the original event'
);
select is(
  (select count(*)::integer from public.paid_refresh_payment_events where request_id = (select request_id from paid_refresh_fixture)),
  1,
  'event replay creates no duplicate'
);
select throws_ok(
  $$select * from public.record_paid_refresh_payment_event(
    (select request_id from paid_refresh_fixture), 'mock:mismatch', 'mock_pi_mismatch',
    'succeeded', 1800, 'usd'
  )$$,
  '22023', 'PAID_REFRESH_PAYMENT_MISMATCH',
  'event persistence rejects amount drift'
);
select throws_ok(
  $$update public.paid_refresh_payment_events set outcome = 'succeeded'
    where request_id = (select request_id from paid_refresh_fixture)$$,
  '55000', 'PAID_REFRESH_EVENT_IMMUTABLE',
  'payment events cannot be updated'
);
select throws_ok(
  $$delete from public.paid_refresh_payment_events
    where request_id = (select request_id from paid_refresh_fixture)$$,
  '55000', 'PAID_REFRESH_EVENT_IMMUTABLE',
  'payment events cannot be deleted'
);

create temporary table action_refresh_fixture as
select id as request_id from public.create_paid_refresh_request(
  '81000000-0000-4000-8000-000000000011',
  '81000000-0000-4000-8000-000000000101',
  '81000000-0000-4000-8000-000000000203',
  1900, 'usd', 'mock'
);
select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select request_id from action_refresh_fixture), 'mock:action:203', 'mock_pi_action_203',
    'requires_action', 1900, 'usd'
  )),
  'requires_action',
  'an action-required outcome is durable'
);
select is(
  (select state from public.paid_refresh_requests where id = (select request_id from action_refresh_fixture)),
  'requires_action',
  'action-required outcome does not mark the request paid'
);
select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '81000000-0000-4000-8000-000000000101', 'force_pull',
    (select request_id from action_refresh_fixture), 'force_pull'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'an action-required payment cannot enqueue analysis'
);

create temporary table other_refresh_fixture as
select id as request_id from public.create_paid_refresh_request(
  '81000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000102',
  '81000000-0000-4000-8000-000000000204',
  1900, 'usd', 'mock'
);
select is((select count(*)::integer from other_refresh_fixture), 1, 'a second scoped consumer can create a request');
select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select request_id from other_refresh_fixture), 'mock:succeeded:204', 'mock_pi_204',
    'succeeded', 1900, 'usd'
  )),
  'succeeded',
  'the second request can persist success'
);
select throws_ok(
  $$select * from public.enqueue_analysis_job(
    '81000000-0000-4000-8000-000000000101', 'force_pull',
    (select request_id from other_refresh_fixture), 'force_pull'
  )$$,
  'P0001', 'ANALYSIS_SOURCE_INVALID',
  'a succeeded event cannot be used with another client'
);

select is(
  (select outcome from public.record_paid_refresh_payment_event(
    (select request_id from paid_refresh_fixture),
    'mock:succeeded:81000000-0000-4000-8000-000000000201',
    'mock_pi_81000000_0000_4000_8000_000000000201',
    'succeeded', 1900, 'usd'
  )),
  'succeeded',
  'the primary request persists succeeded evidence'
);
select is(
  (select count(*)::integer from public.paid_refresh_payment_events
   where request_id = (select request_id from paid_refresh_fixture) and outcome = 'succeeded'),
  1,
  'the request has exactly one succeeded event'
);
select results_eq(
  $$select state, payment_succeeded, latest_payment_outcome
    from public.read_paid_refresh_request((select request_id from paid_refresh_fixture))$$,
  $$values ('paid'::text, true, 'succeeded'::text)$$,
  'resumable read exposes durable paid state'
);

create temporary table paid_analysis_fixture as
select id as job_id, analysis_run_id
from public.enqueue_analysis_job(
  '81000000-0000-4000-8000-000000000101', 'force_pull',
  (select request_id from paid_refresh_fixture), 'force_pull'
);
select is((select count(*)::integer from paid_analysis_fixture), 1, 'paid request enqueues one analysis row');
select is(
  (select count(*)::integer from public.analysis_jobs
   where source_kind = 'force_pull' and source_id = (select request_id from paid_refresh_fixture)),
  1,
  'one force pull analysis row is persisted'
);
select is(
  (select analysis_run_id from public.enqueue_analysis_job(
    '81000000-0000-4000-8000-000000000101', 'force_pull',
    (select request_id from paid_refresh_fixture), 'force_pull'
  )),
  (select analysis_run_id from paid_analysis_fixture),
  'analysis enqueue replay returns the original identity'
);
select is(
  (select count(*)::integer from public.analysis_jobs
   where source_kind = 'force_pull' and source_id = (select request_id from paid_refresh_fixture)),
  1,
  'analysis enqueue replay creates no duplicate'
);
select is(
  (select count(*)::integer from public.background_jobs
   where job = 'analysis.run'
     and subject = 'client:81000000-0000-4000-8000-000000000101'
     and "window" = 'run:' || (select analysis_run_id::text from paid_analysis_fixture)),
  1,
  'migration 111 bridges one exact background tuple'
);
select is(
  (select state from public.link_paid_refresh_analysis(
    (select request_id from paid_refresh_fixture),
    (select analysis_run_id from paid_analysis_fixture)
  )),
  'queued',
  'analysis link advances paid state to queued'
);
select is(
  (select analysis_run_id from public.link_paid_refresh_analysis(
    (select request_id from paid_refresh_fixture),
    (select analysis_run_id from paid_analysis_fixture)
  )),
  (select analysis_run_id from paid_analysis_fixture),
  'analysis link replay returns the original identity'
);
select is(
  (select count(*)::integer from public.audit_log
   where subject_id = (select request_id from paid_refresh_fixture)
     and action = 'paid_refresh.transition'),
  4,
  'primary request records create, failure, success and queue transitions'
);
select ok(
  not exists (
    select 1 from public.audit_log as event
    cross join lateral jsonb_object_keys(event.meta) as key
    where event.subject_id = (select request_id from paid_refresh_fixture)
      and event.action = 'paid_refresh.transition'
      and key not in ('driver', 'from_state', 'to_state', 'status')
  ),
  'paid refresh audit metadata uses only the allowed transition keys'
);
select ok(
  not exists (
    select 1 from public.audit_log as event
    where event.subject_id = (select request_id from paid_refresh_fixture)
      and event.meta::text like '%mock_pi_%'
  ),
  'provider payment references never enter audit metadata'
);
select matches(
  pg_get_functiondef('public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure),
  '(?s)p_source_kind = ''enrollment''.*p_trigger <> ''scheduled''',
  'enrollment source validation remains present'
);
select matches(
  pg_get_functiondef('public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure),
  '(?s)p_source_kind = ''monitoring_event''.*p_trigger <> ''alert''',
  'monitoring source validation remains present'
);
select matches(
  pg_get_functiondef('public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure),
  '(?s)p_source_kind = ''document_upload''.*p_trigger <> ''upload''',
  'document upload source validation remains present'
);
select matches(
  pg_get_functiondef('public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger)'::regprocedure),
  '(?s)p_source_kind = ''force_pull''.*payment_event.outcome = ''succeeded''',
  'force pull branch requires durable succeeded evidence'
);
select is(
  (select count(*)::integer from public.analysis_jobs
   where source_kind = 'force_pull' and source_id in (
     (select request_id from action_refresh_fixture),
     (select request_id from other_refresh_fixture)
   )),
  0,
  'negative cases leave no analysis row'
);
select is(
  (select count(*)::integer from public.background_jobs
   where job = 'analysis.run' and "window" in (
     select 'run:' || analysis_job.analysis_run_id::text
     from public.analysis_jobs as analysis_job
     where analysis_job.source_kind = 'force_pull'
       and analysis_job.source_id in (
         (select request_id from action_refresh_fixture),
         (select request_id from other_refresh_fixture)
       )
   )),
  0,
  'negative cases leave no background tuple'
);

select * from finish();

rollback;
