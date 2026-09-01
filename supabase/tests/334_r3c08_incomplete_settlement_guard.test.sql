begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-08: settlement refuses incomplete ledgers.
select plan(6);

insert into public.orgs(id,name,slug) values
 ('33400000-0000-4000-8000-000000000001','Settlement guard','r3c08-settlement-guard');
insert into public.operator_earnings_ledger(
  id,operator_org_id,accrual_month,base_amount_cents,source_row_count,is_complete,incomplete_code,settlement_status
) values (
  '33400000-0000-4000-8000-000000000002','33400000-0000-4000-8000-000000000001','2026-08-01',4900,1,false,'monitoring_split_unset','accrued'
);

select is((public.revenue_mark_settlement('operator','33400000-0000-4000-8000-000000000002','accrued','exported','00000000-0000-0000-0000-000000000001')->>'reason_code'),'incomplete','incomplete operator accrual refuses export');
select is((select settlement_status::text from public.operator_earnings_ledger where id='33400000-0000-4000-8000-000000000002'),'accrued','refused export leaves the row accrued');
select pg_catalog.set_config('app.settlement_write','on',true);
update public.operator_earnings_ledger set settlement_status='exported' where id='33400000-0000-4000-8000-000000000002';
select pg_catalog.set_config('app.settlement_write','off',true);
select is((public.revenue_mark_settlement('operator','33400000-0000-4000-8000-000000000002','exported','paid','00000000-0000-0000-0000-000000000001')->>'reason_code'),'incomplete','incomplete operator export refuses paid');
insert into public.operator_earnings_ledger(
  id,operator_org_id,accrual_month,base_amount_cents,source_row_count,is_complete,settlement_status
) values (
  '33400000-0000-4000-8000-000000000012','33400000-0000-4000-8000-000000000001','2026-07-01',4900,1,true,'accrued'
);
select is((public.revenue_mark_settlement('operator','33400000-0000-4000-8000-000000000012','accrued','exported','00000000-0000-0000-0000-000000000001')->>'reason_code'),'applied','complete operator accrual exports');
select is((public.revenue_mark_settlement('operator','33400000-0000-4000-8000-000000000012','exported','paid','00000000-0000-0000-0000-000000000001')->>'reason_code'),'applied','complete operator export marks paid');
select is((select settlement_status::text from public.operator_earnings_ledger where id='33400000-0000-4000-8000-000000000012'),'paid','complete operator sequence persists paid');

select * from finish();
rollback;
