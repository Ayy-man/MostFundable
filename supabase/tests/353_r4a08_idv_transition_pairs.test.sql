begin;
set local search_path = public, extensions;

-- 2026-08-18 R4A-08: `enrollment_idv_settled` accepts only the state machine's
-- exact pairs. On c2df7ae every `throws_ok` below is a `lives_ok` that persists
-- a contradiction — `('retry','passed')` was the reviewer's reproduction and
-- manufactures the fact R4A-04's settlement precondition requires.
select plan(26);

insert into public.orgs(id, name, slug) values
  ('35300000-0000-4000-8000-000000000001', 'IDV pairs', 'r4a08-idv-pairs');
insert into public.clients(id, org_id, display_name) values
  ('35300000-0000-4000-8000-000000000002', '35300000-0000-4000-8000-000000000001', 'IDV pairs client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35300000-0000-4000-8000-000000000011', '35300000-0000-4000-8000-000000000002', 'monitoring', 'monitoring-r4a08', pg_catalog.now(), '127.0.0.1', 'r4a08'),
  ('35300000-0000-4000-8000-000000000012', '35300000-0000-4000-8000-000000000002', 'analysis', 'analysis-r4a08', pg_catalog.now(), '127.0.0.1', 'r4a08');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id) values
  ('35300000-0000-4000-8000-000000000003', '35300000-0000-4000-8000-000000000002', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a08');
insert into public.idv_sessions(id, enrollment_id, client_id, member_ref, driver, kind, state, max_attempts)
values ('35300000-0000-4000-8000-000000000004', '35300000-0000-4000-8000-000000000003',
  '35300000-0000-4000-8000-000000000002', 'member-r4a08', 'mock', 'sms', 'sms_sent', 3);

-- The whole invalid cross-product of the two closed vocabularies.
select throws_ok(
  format($$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, %L, %L, null, null)$$,
    pair.outcome, pair.next_state),
  '22023', 'ENROLLMENT_IDV_TRANSITION_INVALID',
  format('the pair (%s, %s) is refused', pair.outcome, pair.next_state))
from (
  select outcome.value as outcome, next_state.value as next_state
  from (values ('pass'), ('retry'), ('locked')) as outcome(value)
  cross join (values ('pending'), ('sms_sent'), ('retry'), ('quiz'), ('passed'), ('locked')) as next_state(value)
  where not (
    (outcome.value = 'retry' and next_state.value in ('quiz', 'retry'))
    or (outcome.value = 'pass' and next_state.value = 'passed')
    or (outcome.value = 'locked' and next_state.value = 'locked')
  )
) as pair;

select is(
  (select state || '/' || coalesce(outcome, 'null') || '/' || attempts_used
   from public.idv_sessions where enrollment_id = '35300000-0000-4000-8000-000000000003'),
  'sms_sent/null/0',
  'a refused pair changes nothing at all');

-- The lock window belongs to the locked pair and to nothing else.
select throws_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'locked', 'locked', null, null)$$,
  '22023', 'ENROLLMENT_IDV_LOCK_WINDOW_REQUIRED',
  'the locked pair requires both the park and lock windows');
select throws_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'retry', 'retry', '2026-09-01T00:00:00Z', null)$$,
  '22023', 'ENROLLMENT_IDV_LOCK_WINDOW_UNEXPECTED',
  'a non-locked pair cannot carry a park window');

-- The three valid machine paths still transition, with the attempt counter
-- incrementing only for retry and locked.
select lives_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'retry', 'quiz', null, null)$$,
  'retry to quiz is a valid transition');
select lives_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'retry', 'retry', null, null)$$,
  'retry to retry is a valid transition');
select is(
  (select attempts_used from public.idv_sessions where enrollment_id = '35300000-0000-4000-8000-000000000003'),
  1, 'only the retry state increments the attempt counter');
select lives_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'pass', 'passed', null, null)$$,
  'pass to passed is a valid transition');
select results_eq(
  $$select state, outcome from public.idv_sessions where enrollment_id = '35300000-0000-4000-8000-000000000003'$$,
  $$values ('passed'::text, 'pass'::text)$$,
  'the persisted pair is never contradictory');
select lives_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000003', null, 'retry', 'retry', null, null)$$,
  'the early return on an already passed session is preserved');
select results_eq(
  $$select state, outcome, attempts_used from public.idv_sessions where enrollment_id = '35300000-0000-4000-8000-000000000003'$$,
  $$values ('passed'::text, 'pass'::text, 1)$$,
  'a passed session is not reopened by a later call');

insert into public.clients(id, org_id, display_name) values
  ('35300000-0000-4000-8000-000000000006', '35300000-0000-4000-8000-000000000001', 'IDV lock client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('35300000-0000-4000-8000-000000000013', '35300000-0000-4000-8000-000000000006', 'monitoring', 'monitoring-r4a08', pg_catalog.now(), '127.0.0.1', 'r4a08-lock'),
  ('35300000-0000-4000-8000-000000000014', '35300000-0000-4000-8000-000000000006', 'analysis', 'analysis-r4a08', pg_catalog.now(), '127.0.0.1', 'r4a08-lock');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id) values
  ('35300000-0000-4000-8000-000000000005', '35300000-0000-4000-8000-000000000006', 'enrolled', pg_catalog.now(), pg_catalog.now(), 'r4a08-lock');
insert into public.idv_sessions(enrollment_id, client_id, member_ref, driver, kind, state, max_attempts)
values ('35300000-0000-4000-8000-000000000005', '35300000-0000-4000-8000-000000000006',
  'member-r4a08-lock', 'mock', 'sms', 'sms_sent', 3);
select lives_ok(
  $$select public.enrollment_idv_settled('35300000-0000-4000-8000-000000000005', null, 'locked', 'locked',
    '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')$$,
  'locked to locked with both windows is a valid transition');
select results_eq(
  $$select session.state, session.attempts_used, enrollment.status::text
    from public.idv_sessions as session
    join public.enrollments as enrollment on enrollment.id = session.enrollment_id
    where session.enrollment_id = '35300000-0000-4000-8000-000000000005'$$,
  $$values ('locked'::text, 1, 'parked'::text)$$,
  'the locked path parks the enrollment and counts the attempt');

select * from finish();
rollback;
