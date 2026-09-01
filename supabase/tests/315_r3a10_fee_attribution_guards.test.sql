begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$insert into public.fee_agreements(client_id, org_id, model, pct, status, source)
    values('a3000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'percentage', 10, 'active', 'platform_admin')$$,
  '42501', null,
  'an operator cannot forge platform administrator agreement authority'
);
select throws_ok(
  $$insert into public.org_fee_defaults(org_id, model, pct, updated_by)
    values('a0000000-0000-0000-0000-000000000001', 'percentage', 12.5, '00000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'an operator cannot forge who updated a workspace fee default'
);
select throws_ok(
  $$insert into public.fee_payments(client_id, org_id, amount_cents, received_on, method, recorded_by)
    values('a3000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 12345, current_date, 'cash', '00000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'an operator cannot forge who recorded a fee payment'
);

select public.fees_set_agreement(
  'a3000000-0000-0000-0000-000000000004', 'percentage', 10, null, null, null, null, 'active'
);
select is(
  (select source from public.fee_agreements where client_id = 'a3000000-0000-0000-0000-000000000004'),
  'operator_override',
  'the agreement RPC stores operator authority from the session'
);

select public.fees_set_org_default(
  'a0000000-0000-0000-0000-000000000001', 'percentage', 12.5, null, null, null, null
);
select is(
  (select updated_by from public.org_fee_defaults where org_id = 'a0000000-0000-0000-0000-000000000001'),
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'the default RPC stores the session actor'
);

select public.fees_record_payment(
  'a3000000-0000-0000-0000-000000000004', 1000, current_date, 'cash', null, null
);
select is(
  (select recorded_by from public.fee_payments
   where client_id = 'a3000000-0000-0000-0000-000000000004'
   order by recorded_at desc limit 1),
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'the payment RPC stores the session actor'
);

insert into public.clients(id, org_id, display_name)
values('31500000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'R3A10 seeded client');
reset role;

select results_eq(
  $$select agreement.status::text, agreement.source,
      (select count(*)::bigint from public.fee_ledger as ledger where ledger.client_id = agreement.client_id)
    from public.fee_agreements as agreement
    where agreement.client_id = '31500000-0000-4000-8000-000000000001'$$,
  $$values ('draft'::text, 'workspace_default'::text, 1::bigint)$$,
  'client creation still seeds one draft workspace-default agreement and one ledger row'
);

select * from finish();
rollback;
