-- R5A-02 — a passing identity session cannot belong to a client that does not own the enrollment.
--
-- The property is asserted twice on purpose, once at each authority, because the finding is that a
-- well-behaved caller was the only thing holding it: the writer refuses the mismatched pair, and
-- the database refuses it again for a writer that never asks. The catalog half is derived rather
-- than named — every foreign key `idv_sessions` declares to `enrollments` must be composite over
-- `(enrollment_id, client_id)`, so re-adding a single-column reference later fails this file.
--
-- Reviewer's reproduction, verbatim in intent: seeded Cameron's enrollment `b5000000…0001` (client
-- `b3000000…0001`) with seeded Casey's client id `a3000000…0001`.
--
-- On d6ae268 the run persists `enrollment_id=b5000000…0001, client_id=a3000000…0001,
-- state=passed, outcome=pass` and `begin_consumer_subscription_attempt` returns
-- `dispatching`. The named failing assertions there are 'enrollment_idv_started refuses an
-- enrollment its client does not own' (it lives instead of raising) and 'no cross-client session
-- row was written' (one row comes back).

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- =============================================================================================
-- The catalog property
-- =============================================================================================

select is_empty(
  $$
    select fk.conname::text
    from pg_catalog.pg_constraint as fk
    where fk.conrelid = 'public.idv_sessions'::regclass
      and fk.contype = 'f'
      and fk.confrelid = 'public.enrollments'::regclass
      and fk.conkey <> array[
        (select attnum from pg_catalog.pg_attribute
         where attrelid = 'public.idv_sessions'::regclass and attname = 'enrollment_id'),
        (select attnum from pg_catalog.pg_attribute
         where attrelid = 'public.idv_sessions'::regclass and attname = 'client_id')
      ]::int2[]
  $$,
  'every idv_sessions reference to enrollments is anchored on the (enrollment, client) pair'
);

select isnt_empty(
  $$
    select fk.conname::text
    from pg_catalog.pg_constraint as fk
    where fk.conrelid = 'public.idv_sessions'::regclass
      and fk.contype = 'f'
      and fk.confrelid = 'public.enrollments'::regclass
  $$,
  'and at least one such reference exists, so the assertion above is not vacuous'
);

-- =============================================================================================
-- The writer refuses the cross-client pair
-- =============================================================================================

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$select public.enrollment_record_setup(
      'b5000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      null, 'mock', 'cus_r5a02', 'seti_r5a02', 'pm_r5a02', 'price_r5a02', 4900, 'enroll:r5a02'
    )$$,
  'the enrollment reaches the setup state the reproduction starts from'
);

-- Fails on d6ae268: this lives, and writes the cross-client row.
select throws_ok(
  $$select public.enrollment_idv_started(
      'b5000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      null, 'mock', 'sms', 3, 'member-r5a02-cross'
    )$$,
  '23503', 'ENROLLMENT_IDV_CLIENT_MISMATCH',
  'enrollment_idv_started refuses an enrollment its client does not own'
);

-- Fails on d6ae268: one row comes back.
select is(
  (select count(*)::int from public.idv_sessions
   where enrollment_id = 'b5000000-0000-0000-0000-000000000001'),
  0,
  'no cross-client session row was written'
);

-- The database refuses the same pair for a writer that never asks the RPC.
select throws_ok(
  $$
    insert into public.idv_sessions (enrollment_id, client_id, driver, kind, state, max_attempts)
    values (
      'b5000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'mock', 'sms', 'passed', 3
    )
  $$,
  '42501', null,
  'and service_role cannot write the row directly either'
);
reset role;

-- The owner cannot write it either, which is the half a grant can never cover.
select throws_ok(
  $$
    insert into public.idv_sessions (enrollment_id, client_id, driver, kind, state, max_attempts)
    values (
      'b5000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'mock', 'sms', 'passed', 3
    )
  $$,
  '23503', null,
  'the composite foreign key refuses the pair for the table owner as well'
);

-- =============================================================================================
-- The gates downstream of the session refuse without it
-- =============================================================================================

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Fails on d6ae268: the mismatched session satisfies the pre-charge identity precondition and this
-- returns `dispatching`.
select throws_ok(
  $$select * from public.begin_consumer_subscription_attempt(
      'b5000000-0000-0000-0000-000000000001', 'enroll:r5a02'
    )$$,
  '23514', 'ENROLLMENT_IDV_NOT_PASSED',
  'the pre-charge dispatch claim refuses when no session of this client has passed'
);

-- =============================================================================================
-- The ordinary same-client machine path is untouched
-- =============================================================================================

select lives_ok(
  $$select public.enrollment_idv_started(
      'b5000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000001',
      null, 'mock', 'sms', 3, 'member-r5a02-own'
    )$$,
  'the enrollment''s own client still starts an identity session'
);
select lives_ok(
  $$select public.enrollment_idv_settled(
      'b5000000-0000-0000-0000-000000000001', null, 'pass', 'passed', null, null
    )$$,
  'and the 353 transition pair still settles it'
);
select results_eq(
  $$
    select client_id::text, state::text, outcome::text
    from public.idv_sessions
    where enrollment_id = 'b5000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('b3000000-0000-0000-0000-000000000001'::text, 'passed'::text, 'pass'::text) $$,
  'the one session on the enrollment belongs to the client that owns it'
);
reset role;

select * from finish();
rollback;
