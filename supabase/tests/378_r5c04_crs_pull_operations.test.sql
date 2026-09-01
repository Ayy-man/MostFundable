-- R5C-04 — a crash between the CRS pull and the persisted result cannot buy the report twice.
--
-- Reviewer's reproduction: the worker calls `softPull`, the provider bills for three reports, the
-- process dies before `createAndPersistResult` commits, the claim is retried and the whole pull is
-- bought again. Nothing in the system distinguished 'already pulled' from 'never pulled', because
-- the only evidence a pull had happened was the derived features that never got written.
--
-- This file covers the durable half: the pre-call record and the constraints that make it what it
-- claims to be. The outbound half — exactly one POST per report code across both attempts, with the
-- key stable across the retry — is `web/src/lib/analysis/pull-operations.test.ts`, because that is
-- where the fetches are countable. A TypeScript test exercises the caller, and the caller never
-- deliberately violates a CHECK, so everything below is the half TypeScript cannot reach.
--
-- Where the assertions come from: the three closed vocabularies are extracted from
-- `pg_get_constraintdef` at test time, so the test cannot agree with a constraint that has drifted.
-- The settlement shape is measured — every combination is attempted and the accepted set compared —
-- rather than read off the constraint text, because parsing a disjunction of conjunctions back into
-- triples would be a second parser to get wrong. The three legal triples themselves are transcribed
-- and that is the one transcription in this file.
--
-- On d6ae268 neither the table nor the functions exist, so the file cannot run there at all; the
-- watched-failing run disabled the recovery signal inside the test transaction instead — see
-- ROUND-5-W2-FIXES.md. The named failing assertions under that revert are 'the second attempt is
-- told the pull already went out' and 'a settled operation still reports what it settled as on
-- replay'.

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(24);

insert into auth.users (id, email) values
  ('37800000-0000-4000-8000-000000000011', 'r5c04-consumer-a@test.example'),
  ('37800000-0000-4000-8000-000000000012', 'r5c04-consumer-b@test.example');
insert into public.orgs (id, name, slug)
values ('37800000-0000-4000-8000-000000000001', 'R5C04 Org', 'r5c04-org');
insert into public.profiles (id, role, org_id, full_name, email) values
  ('37800000-0000-4000-8000-000000000011', 'consumer', '37800000-0000-4000-8000-000000000001',
   'R5C04 Consumer A', 'r5c04-consumer-a@test.example'),
  ('37800000-0000-4000-8000-000000000012', 'consumer', '37800000-0000-4000-8000-000000000001',
   'R5C04 Consumer B', 'r5c04-consumer-b@test.example')
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, full_name = excluded.full_name;
insert into public.clients (id, org_id, consumer_profile_id, display_name) values
  ('37800000-0000-4000-8000-000000000101', '37800000-0000-4000-8000-000000000001',
   '37800000-0000-4000-8000-000000000011', 'R5C04 Client A'),
  ('37800000-0000-4000-8000-000000000102', '37800000-0000-4000-8000-000000000001',
   '37800000-0000-4000-8000-000000000012', 'R5C04 Client B');

-- =============================================================================================
-- The pre-call record, and the signal a recovering attempt reads off it
-- =============================================================================================

select results_eq(
  $$select state, replay from public.crs_pull_operation_begin(
      '37800000-0000-4000-8000-000000000101',
      '37800000-0000-4000-8000-000000000201',
      array['EQF1001', 'EXP1001', 'TUC3002']
    )$$,
  $$ values ('dispatched'::text, false) $$,
  'the first attempt records the pull before it goes out and is told it is the first'
);

-- Fails with the recovery signal disabled: comes back `false`, so the retry pulls again.
select results_eq(
  $$select state, replay from public.crs_pull_operation_begin(
      '37800000-0000-4000-8000-000000000101',
      '37800000-0000-4000-8000-000000000201',
      array['EQF1001', 'EXP1001', 'TUC3002']
    )$$,
  $$ values ('dispatched'::text, true) $$,
  'the second attempt is told the pull already went out'
);

-- The key is derived from the operation, so it is the same string both times without anyone
-- carrying it across the crash. Asserted against the derivation, not against a transcribed literal.
select results_eq(
  $$select distinct operation.idempotency_key = 'analysis:' || operation.analysis_run_id::text
    from public.crs_pull_operations as operation$$,
  $$ values (true) $$,
  'every operation key is derived from its analysis run, so a retry cannot change it'
);
select is(
  (select count(distinct idempotency_key)::int from public.crs_pull_operations
   where analysis_run_id = '37800000-0000-4000-8000-000000000201'),
  1, 'and both attempts share exactly one key'
);

-- A run id belongs to one client. The other client is a defect, not a replay, and this is the
-- branch most worth a test: if it is ever wrong it is a cross-tenant read.
select throws_ok(
  $$select * from public.crs_pull_operation_begin(
      '37800000-0000-4000-8000-000000000102',
      '37800000-0000-4000-8000-000000000201',
      array['EQF1001']
    )$$,
  '22023', 'CRS_PULL_OPERATION_CLIENT_MISMATCH',
  'a second client cannot be handed the first client''s operation'
);

-- =============================================================================================
-- Settling it, and what a later attempt learns
-- =============================================================================================

select is(
  public.crs_pull_operation_returned(
    '37800000-0000-4000-8000-000000000101',
    '37800000-0000-4000-8000-000000000201',
    array['EQF', 'EXP', 'TUC']
  ),
  true, 'the report coming back settles the operation'
);
select is(
  public.crs_pull_operation_returned(
    '37800000-0000-4000-8000-000000000101',
    '37800000-0000-4000-8000-000000000201',
    array['EQF']
  ),
  false, 'and it cannot be settled a second time with a different answer'
);

-- Fails with the recovery signal disabled: the caller cannot tell a settled pull from a fresh one.
select results_eq(
  $$select state, replay from public.crs_pull_operation_begin(
      '37800000-0000-4000-8000-000000000101',
      '37800000-0000-4000-8000-000000000201',
      array['EQF1001', 'EXP1001', 'TUC3002']
    )$$,
  $$ values ('returned'::text, true) $$,
  'a settled operation still reports what it settled as on replay'
);

-- The other settlement: dispatched, and nobody knows whether the provider billed.
select * from public.crs_pull_operation_begin(
  '37800000-0000-4000-8000-000000000102',
  '37800000-0000-4000-8000-000000000202',
  array['EQF1001']
);
select is(
  public.crs_pull_operation_indeterminate(
    '37800000-0000-4000-8000-000000000102',
    '37800000-0000-4000-8000-000000000202'
  ),
  true, 'an attempt that cannot prove the pull never happened settles as indeterminate'
);

-- =============================================================================================
-- The constraints, read off the catalog rather than restated
-- =============================================================================================

create temporary table r5c04_vocab on commit drop as
select con.conname::text as constraint_name, literal[1]::text as value
from pg_catalog.pg_constraint as con
cross join lateral pg_catalog.regexp_matches(
  pg_catalog.pg_get_constraintdef(con.oid), $re$'([A-Za-z0-9_]+)'$re$, 'g'
) as literal
where con.conrelid = 'public.crs_pull_operations'::regclass
  and con.contype = 'c'
  and con.conname in (
    'crs_pull_operations_codes_bounded',
    'crs_pull_operations_bureaus_bounded',
    'crs_pull_operations_state_closed'
  );

-- The non-vacuity guard. Without it every derived assertion below passes by ranging over nothing.
select results_eq(
  $$select count(distinct constraint_name)::int, (count(*) >= 9) from r5c04_vocab$$,
  $$ values (3, true) $$,
  'the three closed vocabularies were actually read off the constraints'
);

-- Every code the constraint declares is accepted, counted against the derived list rather than
-- against the number three.
create temporary table r5c04_code_probe (code text, accepted boolean) on commit drop;
do $probe$
declare
  v_code text;
  v_id uuid;
begin
  for v_code in
    select value from r5c04_vocab where constraint_name = 'crs_pull_operations_codes_bounded'
  loop
    v_id := extensions.gen_random_uuid();
    begin
      insert into public.crs_pull_operations (
        analysis_run_id, client_id, idempotency_key, report_codes
      ) values (
        v_id, '37800000-0000-4000-8000-000000000101', 'analysis:' || v_id::text, array[v_code]
      );
      insert into r5c04_code_probe values (v_code, true);
    exception when others then
      insert into r5c04_code_probe values (v_code, false);
    end;
  end loop;
end;
$probe$;

select is_empty(
  $$select code from r5c04_code_probe where not accepted$$,
  'every report code the constraint declares is one the table accepts'
);

-- ...and a code it does not declare is refused. The offending value is built out of the derived
-- list, so it cannot accidentally become a member if the allow-list ever widens.
select throws_ok(
  pg_catalog.format(
    $$insert into public.crs_pull_operations (
        analysis_run_id, client_id, idempotency_key, report_codes
      ) values (
        '37800000-0000-4000-8000-000000000211',
        '37800000-0000-4000-8000-000000000101',
        'analysis:37800000-0000-4000-8000-000000000211',
        array[%L]
      )$$,
    (select 'NOT' || string_agg(value, '') from r5c04_vocab
     where constraint_name = 'crs_pull_operations_codes_bounded')
  ),
  '23514', null,
  'a report code the constraint does not declare is refused'
);

select throws_ok(
  $$insert into public.crs_pull_operations (
      analysis_run_id, client_id, idempotency_key, report_codes
    ) values (
      '37800000-0000-4000-8000-000000000212',
      '37800000-0000-4000-8000-000000000101',
      'analysis:37800000-0000-4000-8000-000000000212',
      array[]::text[]
    )$$,
  '23514', null,
  'an operation that requests no report at all is refused'
);

select throws_ok(
  $$insert into public.crs_pull_operations (
      analysis_run_id, client_id, idempotency_key, report_codes
    ) values (
      '37800000-0000-4000-8000-000000000213',
      '37800000-0000-4000-8000-000000000101',
      'analysis:37800000-0000-4000-8000-000000000213',
      array['EQF1001', 'EXP1001', 'TUC3002', 'EQF1001']
    )$$,
  '23514', null,
  'and one that requests more reports than there are bureaus is refused on the cardinality bound'
);

-- The key is the one column a value could be smuggled through, so its shape has to be enforced
-- rather than merely produced by the single writer that exists today.
select throws_ok(
  $$insert into public.crs_pull_operations (
      analysis_run_id, client_id, idempotency_key, report_codes
    ) values (
      '37800000-0000-4000-8000-000000000214',
      '37800000-0000-4000-8000-000000000101',
      'analysis:37800000-0000-4000-8000-000000000299',
      array['EQF1001']
    )$$,
  '23514', null,
  'an idempotency key that is not derived from the run id is refused'
);

-- The settlement shape, measured rather than read. Every combination of state, settled_at and
-- bureaus_returned is attempted and the accepted set is what the assertion compares; a constraint
-- that widened to admit a fourth shape would fail here even though no writer would produce it.
create temporary table r5c04_shape_probe (
  state text, settled boolean, bureaus boolean
) on commit drop;
do $probe$
declare
  v_state text;
  v_settled boolean;
  v_bureaus boolean;
  v_id uuid;
begin
  for v_state in
    select value from r5c04_vocab where constraint_name = 'crs_pull_operations_state_closed'
  loop
    foreach v_settled in array array[true, false] loop
      foreach v_bureaus in array array[true, false] loop
        v_id := extensions.gen_random_uuid();
        begin
          insert into public.crs_pull_operations (
            analysis_run_id, client_id, idempotency_key, report_codes,
            state, settled_at, bureaus_returned
          ) values (
            v_id, '37800000-0000-4000-8000-000000000101', 'analysis:' || v_id::text,
            array['EQF1001'], v_state,
            case when v_settled then pg_catalog.clock_timestamp() else null end,
            case when v_bureaus then array['EQF'] else null end
          );
          insert into r5c04_shape_probe values (v_state, v_settled, v_bureaus);
        exception when others then
          null;
        end;
      end loop;
    end loop;
  end loop;
end;
$probe$;

-- The three legal shapes are transcribed here; the accepted set they are compared against is not.
select results_eq(
  $$select state, settled, bureaus from r5c04_shape_probe order by state, settled, bureaus$$,
  $$ values
      ('dispatched'::text, false, false),
      ('indeterminate'::text, true, false),
      ('returned'::text, true, true)
  $$,
  'the table accepts exactly the three settlement shapes and no fourth'
);

-- =============================================================================================
-- The rails: identifiers and classifications only, derived over the catalog
-- =============================================================================================

create temporary view r5c04_stored_text as
select operation.analysis_run_id, column_value.attname, column_value.value
from public.crs_pull_operations as operation
cross join lateral (
  select att.attname::text as attname,
         pg_catalog.jsonb_array_elements_text(
           case pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(operation) -> att.attname::text)
             when 'array' then pg_catalog.to_jsonb(operation) -> att.attname::text
             when 'null' then '[]'::jsonb
             else pg_catalog.jsonb_build_array(
               pg_catalog.to_jsonb(operation) ->> att.attname::text
             )
           end
         ) as value
  from pg_catalog.pg_attribute as att
  where att.attrelid = 'public.crs_pull_operations'::regclass
    and att.attnum > 0 and not att.attisdropped
    and pg_catalog.format_type(att.atttypid, null) in ('text', 'text[]')
) as column_value;

-- The non-vacuity guard again: the property below is an `is_empty`, and an empty table satisfies
-- that for the wrong reason.
select cmp_ok(
  (select count(*)::int from r5c04_stored_text), '>', 0,
  'there is stored text to range over, so the property below is not vacuous'
);

select is_empty(
  $$
    select pg_catalog.format('%s=%s', stored.attname, stored.value)
    from r5c04_stored_text as stored
    where stored.value not in (select value from r5c04_vocab)
      and stored.value <> 'analysis:' || stored.analysis_run_id::text
  $$,
  'every text the operation record holds is a report code, a bureau, a state or the derived key'
);

-- =============================================================================================
-- The table takes the treatment 374's boundary gives every governed record
-- =============================================================================================

select results_eq(
  $$select relrowsecurity, relforcerowsecurity
    from pg_catalog.pg_class where oid = 'public.crs_pull_operations'::regclass$$,
  $$ values (true, true) $$,
  'row security is enabled and forced, so the table owner is inside it too'
);
select table_privs_are(
  'public', 'crs_pull_operations', 'service_role', array['SELECT'],
  'service_role can read the record and nothing more'
);
select table_privs_are(
  'public', 'crs_pull_operations', 'authenticated', array[]::text[],
  'an authenticated session holds no privilege on it at all'
);
select table_privs_are(
  'public', 'crs_pull_operations', 'anon', array[]::text[],
  'and neither does an anonymous one'
);

-- =============================================================================================
-- The record is durable, which is the whole point of it
-- =============================================================================================

select isnt_empty(
  $$select table_name from private.erasure_boundary_tables()
    where table_name = 'crs_pull_operations'$$,
  'the operation record is inside the erasure boundary, so nothing can quietly delete the evidence'
);
select throws_ok(
  $$truncate table public.crs_pull_operations$$,
  '42501', null,
  'and it cannot be truncated away either'
);

select * from finish();
rollback;
