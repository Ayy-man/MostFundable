begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r3a03_changed', 'r3a03_outcome', 'r3a03_plain']) as handle
on conflict (bank_ref) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
insert into public.applications(id, client_id, bank_ref, created_by) values
  ('31700000-0000-4000-8000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'r3a03_plain', 'a1000000-0000-0000-0000-000000000001'),
  ('31700000-0000-4000-8000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'r3a03_outcome', 'a1000000-0000-0000-0000-000000000001');
select public.record_outcome(
  '31700000-0000-4000-8000-000000000002', 'denied', null, current_date, null
);

select throws_ok(
  $$update public.applications set client_id = 'a3000000-0000-0000-0000-000000000002'
    where id = '31700000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an application without an outcome cannot move to another client'
);
select throws_ok(
  $$update public.applications set client_id = 'a3000000-0000-0000-0000-000000000002'
    where id = '31700000-0000-4000-8000-000000000002'$$,
  '42501', null,
  'an application with an outcome cannot move to another client'
);
select throws_ok(
  $$update public.applications set bank_ref = 'r3a03_changed'
    where id = '31700000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an application bank reference cannot be re-filed'
);
select throws_ok(
  $$update public.applications set created_by = 'a1000000-0000-0000-0000-000000000002'
    where id = '31700000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'application creation attribution is immutable'
);

select lives_ok(
  $$update public.applications
    set operator_status = 'todo', amount_cents = 42000,
        updated_at = '2099-01-01T00:00:00Z'
    where id = '31700000-0000-4000-8000-000000000001'$$,
  'the mutable application status and amount fields remain writable'
);
reset role;

select results_eq(
  $$select operator_status::text, amount_cents, updated_at
    from public.applications where id = '31700000-0000-4000-8000-000000000001'$$,
  $$values ('todo'::text, 42000::bigint, '2099-01-01T00:00:00Z'::timestamptz)$$,
  'an allowed application patch persists its status, amount, and updated timestamp'
);

select * from finish();
rollback;
