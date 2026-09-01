begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into public.banks_cache (bank_ref, name, application_questions)
values ('projection-bank', 'Projection Bank', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb)
on conflict (bank_ref) do nothing;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000004061', 'projection@test.example');
insert into public.orgs (id, name, slug)
values ('00000000-0000-0000-0000-000000004062', 'Projection org', 'projection-org');
insert into public.profiles (id, role, org_id, org_role, full_name, email)
values ('00000000-0000-0000-0000-000000004061', 'operator_member', '00000000-0000-0000-0000-000000004062', 'owner', 'Projection Owner', 'projection@test.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, display_name)
values ('00000000-0000-0000-0000-000000004063', '00000000-0000-0000-0000-000000004062', 'Projection Client');
insert into public.applications (id, client_id, bank_ref, created_by)
values ('00000000-0000-0000-0000-000000004064', '00000000-0000-0000-0000-000000004063', 'projection-bank', '00000000-0000-0000-0000-000000004061');

insert into public.outcomes (id, application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind)
values ('00000000-0000-0000-0000-000000004065', '00000000-0000-0000-0000-000000004064', 'projection-bank', '00000000-0000-0000-0000-000000004063', 'approved', 4500000, '00000000-0000-0000-0000-000000004061', 'operator');

select is((select funded_amount_cents from public.clients where id = '00000000-0000-0000-0000-000000004063'), 4500000::bigint, 'an approved outcome updates the tracker funded amount');
select is((select outcome_basis_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004063'), 4500000::bigint, 'the fee basis is the same approved-outcome sum');

update public.outcomes
set state = 'removed', removed_at = clock_timestamp(), removed_by = '00000000-0000-0000-0000-000000004061'
where id = '00000000-0000-0000-0000-000000004065';

select is((select funded_amount_cents from public.clients where id = '00000000-0000-0000-0000-000000004063'), 0::bigint, 'removing the outcome clears the tracker projection');
select is((select outcome_basis_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004063'), 0::bigint, 'removing the outcome clears the fee basis in the same transaction');

select * from finish();
rollback;
