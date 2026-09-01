begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r3a02_consumer', 'r3a02_operator']) as handle
on conflict (bank_ref) do nothing;

-- 2026-08-18 R4A-02 carry: an application write now needs an operator or
-- platform-admin caller, so the fixture that proves the R3A-02 creator
-- normalizer runs under the operator owner and forges Casey's id instead of the
-- other way round. The normalizer claim is unchanged — a forged `created_by` is
-- replaced by the session profile — and the consumer arms below still run under
-- Casey's own JWT.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
insert into public.applications(id, client_id, bank_ref, created_by)
values(
  '31100000-0000-4000-8000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'r3a02_consumer',
  'a1000000-0000-0000-0000-000000000011'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select throws_ok(
  $$insert into public.outcomes(
      id, application_id, bank_ref, client_id, kind, amount_cents,
      recorded_by, recorded_by_kind
    ) values (
      '31100000-0000-4000-8000-000000000002',
      '31100000-0000-4000-8000-000000000001', 'r3a02_consumer',
      'a3000000-0000-0000-0000-000000000001', 'approved', 99999999,
      'a1000000-0000-0000-0000-000000000001', 'operator'
    )$$,
  '42501', null,
  'a consumer cannot insert an outcome with forged operator attribution'
);
reset role;

select is(
  (select created_by from public.applications where id = '31100000-0000-4000-8000-000000000001'),
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'an authenticated application insert stores the session profile as creator'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select public.record_outcome(
  '31100000-0000-4000-8000-000000000001', 'approved', 10000, current_date, null
);
reset role;
select results_eq(
  $$select recorded_by, recorded_by_kind::text,
      (select count(*)::bigint from public.outcome_reviews as review where review.outcome_id = outcome.id)
    from public.outcomes as outcome
    where application_id = '31100000-0000-4000-8000-000000000001'$$,
  $$values ('a1000000-0000-0000-0000-000000000011'::uuid, 'consumer'::text, 1::bigint)$$,
  'the consumer RPC derives attribution and creates one review row'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
insert into public.applications(id, client_id, bank_ref, created_by)
values(
  '31100000-0000-4000-8000-000000000003',
  'a3000000-0000-0000-0000-000000000004',
  'r3a02_operator',
  'a1000000-0000-0000-0000-000000000001'
);
select public.record_outcome(
  '31100000-0000-4000-8000-000000000003', 'denied', null, current_date, null
);
reset role;
select results_eq(
  $$select recorded_by, recorded_by_kind::text,
      (select count(*)::bigint from public.outcome_reviews as review where review.outcome_id = outcome.id)
    from public.outcomes as outcome
    where application_id = '31100000-0000-4000-8000-000000000003'$$,
  $$values ('a1000000-0000-0000-0000-000000000001'::uuid, 'operator'::text, 1::bigint)$$,
  'the operator RPC derives attribution and creates one review row'
);

select * from finish();
rollback;
