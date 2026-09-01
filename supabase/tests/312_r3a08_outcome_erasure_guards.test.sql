begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r3a08_a', 'r3a08_b']) as handle
on conflict (bank_ref) do nothing;

insert into public.applications(id, client_id, bank_ref, created_by) values
  ('31200000-0000-4000-8000-000000000001', 'a3000000-0000-0000-0000-000000000004', 'r3a08_a', 'a1000000-0000-0000-0000-000000000001'),
  ('31200000-0000-4000-8000-000000000002', 'a3000000-0000-0000-0000-000000000004', 'r3a08_b', 'a1000000-0000-0000-0000-000000000001');
insert into public.outcomes(
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind
) values
  ('31200000-0000-4000-8000-000000000101', '31200000-0000-4000-8000-000000000001', 'r3a08_a', 'a3000000-0000-0000-0000-000000000004', 'approved', 12345, 'a1000000-0000-0000-0000-000000000001', 'operator'),
  ('31200000-0000-4000-8000-000000000102', '31200000-0000-4000-8000-000000000002', 'r3a08_b', 'a3000000-0000-0000-0000-000000000004', 'approved', 54321, 'a1000000-0000-0000-0000-000000000001', 'operator');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$delete from public.outcomes where id = '31200000-0000-4000-8000-000000000101'$$,
  '42501', null,
  'service role cannot physically delete an outcome'
);
select throws_ok(
  $$truncate table public.outcomes$$,
  '42501', null,
  'service role cannot truncate outcome evidence'
);
select public.review_outcome(
  '31200000-0000-4000-8000-000000000101',
  'removed',
  '00000000-0000-0000-0000-000000000001'
);
reset role;

select is(
  (select state from public.outcomes where id = '31200000-0000-4000-8000-000000000101'),
  'removed'::public.outcome_state,
  'the governed review path tombstones the outcome'
);
select is(
  (select outcome_basis_cents from public.fee_ledger where client_id = 'a3000000-0000-0000-0000-000000000004'),
  54321::bigint,
  'tombstoning recomputes the fee basis to the remaining approved sum'
);

select * from finish();
rollback;
