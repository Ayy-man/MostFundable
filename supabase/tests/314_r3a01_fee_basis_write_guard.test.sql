begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r3a01']) as handle
on conflict (bank_ref) do nothing;

insert into public.clients(id, org_id, display_name)
values('31400000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'R3A01 client');
insert into public.fee_ledger(client_id, org_id)
values('31400000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.applications(id, client_id, bank_ref, created_by)
values('31400000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-000000000001', 'r3a01', 'a1000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$insert into public.fee_ledger(client_id, org_id, outcome_basis_cents)
    values('31400000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001', 77777777)$$,
  '42501', null,
  'an operator cannot insert an arbitrary outcome fee basis'
);
select throws_ok(
  $$update public.fee_ledger set outcome_basis_cents = 88888888
    where client_id = '31400000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an operator cannot update the derived outcome fee basis'
);
select public.record_outcome(
  '31400000-0000-4000-8000-000000000002', 'approved', 50000, current_date, null
);
reset role;
select is(
  (select outcome_basis_cents from public.fee_ledger where client_id = '31400000-0000-4000-8000-000000000001'),
  50000::bigint,
  'recording an approved outcome derives the exact fee basis'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.review_outcome(
  (select id from public.outcomes where application_id = '31400000-0000-4000-8000-000000000002'),
  'removed',
  '00000000-0000-0000-0000-000000000001'
);
reset role;
select is(
  (select outcome_basis_cents from public.fee_ledger where client_id = '31400000-0000-4000-8000-000000000001'),
  0::bigint,
  'withdrawing the outcome recomputes the basis to zero'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select public.fees_record_payment(
  '31400000-0000-4000-8000-000000000001', 1000, current_date, 'cash', null, null
);
reset role;
select is(
  (select paid_cents from public.fee_ledger where client_id = '31400000-0000-4000-8000-000000000001'),
  1000::bigint,
  'recording a payment still recomputes the ordinary paid total'
);

select * from finish();
rollback;
