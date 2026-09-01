begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r2a11_record', 'r2a11_review']) as handle
on conflict (bank_ref) do nothing;

insert into public.applications (id, client_id, bank_ref, created_by)
values
  ('27500000-0000-4000-8000-000000000101','a3000000-0000-0000-0000-000000000001','r2a11_review','a1000000-0000-0000-0000-000000000001'),
  ('27500000-0000-4000-8000-000000000102','a3000000-0000-0000-0000-000000000002','r2a11_record','a1000000-0000-0000-0000-000000000001');
insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
) values (
  '27500000-0000-4000-8000-000000000201','27500000-0000-4000-8000-000000000101',
  'r2a11_review','a3000000-0000-0000-0000-000000000001','approved',1000,
  'a1000000-0000-0000-0000-000000000011','consumer'
);

update public.profiles set disabled_at = pg_catalog.clock_timestamp()
where id in (
  '00000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000011'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select public.set_client_status('a3000000-0000-0000-0000-000000000004','archived','a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'disabled operator cannot change client status'
);
reset role;
select is((select status from public.clients where id = 'a3000000-0000-0000-0000-000000000004'),'active'::public.client_status,'disabled operator status call writes nothing');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'disabled operator cannot read through the cap definer'
);
select throws_ok(
  $$select public.tracker_transition_client_stage(
    'a3000000-0000-0000-0000-000000000004','optimization','onboarding',
    'a1000000-0000-0000-0000-000000000001','manual',null
  )$$,
  '42501', null, 'disabled operator cannot transition through the tracker definer'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select public.review_outcome('27500000-0000-4000-8000-000000000201','approved','00000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'disabled platform administrator cannot review an outcome'
);
reset role;
select is((select state from public.outcome_reviews where outcome_id = '27500000-0000-4000-8000-000000000201'),'pending'::public.outcome_review_state,'disabled review call writes nothing');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select throws_ok(
  $$select public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'disabled affiliate cannot read through the cap definer'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.set_client_status('a3000000-0000-0000-0000-000000000003','archived','a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'service role rejects a disabled explicit operator actor'
);
select throws_ok(
  $$select public.review_outcome('27500000-0000-4000-8000-000000000201','approved','00000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'service role rejects a disabled explicit administrator actor'
);
select throws_ok(
  $$select public.record_outcome(
    '27500000-0000-4000-8000-000000000102','denied',null,current_date,
    'a1000000-0000-0000-0000-000000000011'
  )$$,
  '42501', null, 'service role rejects a disabled explicit outcome actor'
);
select is((select count(*)::integer from public.outcomes where application_id = '27500000-0000-4000-8000-000000000102'),0,'disabled outcome call writes nothing');

select * from finish();
rollback;
