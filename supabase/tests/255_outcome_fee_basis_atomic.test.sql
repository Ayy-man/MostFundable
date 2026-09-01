begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-11: the outcome row and derived fee basis cannot diverge.
-- 2026-08-17 R2A-13 carry: inserts and corrections derive the exact sum with
-- no application-callable alternate writer.
select plan(8);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['bank_a', 'bank_b']) as handle
on conflict (bank_ref) do nothing;

insert into auth.users(id,email) values ('25500000-0000-4000-8000-000000000001','actor@r1c11.test');
insert into public.orgs(id,name,slug) values ('25500000-0000-4000-8000-000000000101','R1C11 Org','r1c11-org');
insert into public.profiles(id,role,org_id,org_role,full_name,email) values
 ('25500000-0000-4000-8000-000000000001','operator_member','25500000-0000-4000-8000-000000000101','owner','R1C11 Actor','actor@r1c11.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=excluded.org_role,
  full_name=excluded.full_name,email=excluded.email;
insert into public.clients(id,org_id,display_name) values
 ('25500000-0000-4000-8000-000000000201','25500000-0000-4000-8000-000000000101','R1C11 Client');
insert into public.applications(id,client_id,bank_ref,created_by) values
 ('25500000-0000-4000-8000-000000000301','25500000-0000-4000-8000-000000000201','bank_a','25500000-0000-4000-8000-000000000001'),
 ('25500000-0000-4000-8000-000000000302','25500000-0000-4000-8000-000000000201','bank_b','25500000-0000-4000-8000-000000000001');

insert into public.outcomes(id,application_id,bank_ref,client_id,kind,amount_cents,recorded_by,recorded_by_kind)
values('25500000-0000-4000-8000-000000000401','25500000-0000-4000-8000-000000000301','bank_a','25500000-0000-4000-8000-000000000201','approved',62500,'25500000-0000-4000-8000-000000000001','operator');
select is((select outcome_basis_cents from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),62500::bigint,'insert commits its basis in the same transaction');

insert into public.outcomes(id,application_id,bank_ref,client_id,kind,amount_cents,recorded_by,recorded_by_kind)
values('25500000-0000-4000-8000-000000000402','25500000-0000-4000-8000-000000000302','bank_b','25500000-0000-4000-8000-000000000201','approved',37500,'25500000-0000-4000-8000-000000000001','operator');
select is((select outcome_basis_cents from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),100000::bigint,'multiple counted outcomes converge to their sum');

update public.outcomes set amount_cents=42500
where id='25500000-0000-4000-8000-000000000402';
select is((select outcome_basis_cents from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),105000::bigint,'an amount correction derives the exact counted-outcome sum');

update public.outcomes set state='removed',removed_at=clock_timestamp(),removed_by='25500000-0000-4000-8000-000000000001'
where id='25500000-0000-4000-8000-000000000401';
select is((select outcome_basis_cents from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),42500::bigint,'state correction recomputes rather than increments');
select is((select outcome_basis_source from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),'outcome_withdrawn','correction provenance is retained');

select throws_ok($$insert into public.outcomes(id,application_id,bank_ref,client_id,kind,amount_cents,recorded_by,recorded_by_kind) values('25500000-0000-4000-8000-000000000403','25500000-0000-4000-8000-000000000302','bank_b','25500000-0000-4000-8000-000000000201','approved',99999,'25500000-0000-4000-8000-000000000001','operator')$$,'23505',null,'a failed outcome transaction cannot partially change the basis');
select is((select outcome_basis_cents from public.fee_ledger where client_id='25500000-0000-4000-8000-000000000201'),42500::bigint,'basis remains aligned after rollback');
select has_trigger('public','outcomes','outcomes_sync_fee_basis','outcomes carry the atomic fee-basis trigger');

select * from finish();
rollback;
