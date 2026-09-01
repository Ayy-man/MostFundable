begin;
set local search_path = public, extensions;

select plan(51);

select enum_has_labels('public', 'settlement_status', array['accrued','exported','paid','reversed'], 'settlement status is closed');
select has_column('public', 'operator_earnings_ledger', 'settlement_status', 'operator ledger has settlement status');
select has_column('public', 'referral_ledger', 'settlement_status', 'referral ledger has settlement status');
select col_not_null('public', 'operator_earnings_ledger', 'settlement_status', 'operator status is required');
select col_not_null('public', 'referral_ledger', 'settlement_status', 'referral status is required');
select col_default_is('public', 'operator_earnings_ledger', 'settlement_status', 'accrued'::public.settlement_status, 'operator rows default accrued');
select col_default_is('public', 'referral_ledger', 'settlement_status', 'accrued'::public.settlement_status, 'referral rows default accrued');
select has_column('public', 'orgs', 'stripe_account_id', 'orgs have optional Stripe account');
select has_column('public', 'orgs', 'payouts_enabled', 'orgs have optional payout readiness');
select has_column('public', 'saas_referrals', 'stripe_account_id', 'referrals have optional Stripe account');
select has_column('public', 'saas_referrals', 'payouts_enabled', 'referrals have optional payout readiness');
select col_is_null('public', 'orgs', 'stripe_account_id', 'org Stripe account is nullable');
select col_is_null('public', 'orgs', 'payouts_enabled', 'org payout readiness is nullable');
select has_trigger('public', 'operator_earnings_ledger', 'operator_earnings_ledger_prevent_change', 'operator immutability trigger remains');
select has_trigger('public', 'referral_ledger', 'referral_ledger_prevent_change', 'referral immutability trigger remains');
select has_table('public', 'billing_refund_observations', 'refund observation table exists');
select has_trigger('public', 'billing_refund_observations', 'billing_refund_observations_prevent_change', 'refund rows are append-only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.billing_refund_observations'::regclass), 'refund RLS is enabled and forced');
select ok(not has_table_privilege('authenticated', 'public.billing_refund_observations', 'insert'), 'authenticated cannot insert refund evidence');
select ok(not has_table_privilege('service_role', 'public.billing_refund_observations', 'insert'), 'service role writes refunds only through the RPC');
select ok(has_function_privilege('service_role', 'public.billing_record_refund_observation(text,text,text,text,bigint,text,timestamptz)', 'execute'), 'service role reaches refund RPC');
select ok(not has_function_privilege('authenticated', 'public.revenue_mark_settlement(text,uuid,public.settlement_status,public.settlement_status,uuid)', 'execute'), 'authenticated cannot call settlement writer directly');

insert into auth.users(id,email) values
 ('18100000-0000-4000-8000-000000000001','admin@settlement.test'),
 ('18100000-0000-4000-8000-000000000002','owner@settlement.test');
insert into public.orgs(id,name,slug) values
 ('18100000-0000-4000-8000-000000000100','Settlement Payee','settlement-payee'),
 ('18100000-0000-4000-8000-000000000101','Settlement Operator','settlement-operator');
insert into public.profiles(id,role,org_id,org_role,full_name,email) values
 ('18100000-0000-4000-8000-000000000001','platform_admin',null,null,'Settlement Admin','admin@settlement.test'),
 ('18100000-0000-4000-8000-000000000002','operator_member','18100000-0000-4000-8000-000000000101','owner','Settlement Owner','owner@settlement.test')
on conflict(id) do update set role=excluded.role,org_id=excluded.org_id,org_role=excluded.org_role,full_name=excluded.full_name,email=excluded.email;

insert into public.saas_referrals(id,referrer_org_id,referred_org_id,started_at) values
 ('18100000-0000-4000-8000-000000000200','18100000-0000-4000-8000-000000000100','18100000-0000-4000-8000-000000000101','2026-08-01');
insert into public.operator_earnings_ledger(
 id,operator_org_id,accrual_month,base_amount_cents,pct_snapshot,amount_cents,source_row_count,is_complete,incomplete_code
) values (
 '18100000-0000-4000-8000-000000000300','18100000-0000-4000-8000-000000000101','2026-08-01',10000,40,4000,1,true,null
);
insert into public.referral_ledger(
 id,saas_referral_id,referrer_org_id,referred_org_id,accrual_month,cycle_number,base_snapshot,
 base_amount_cents,pct_snapshot,amount_cents,source_row_count,is_complete,incomplete_code
) values (
 '18100000-0000-4000-8000-000000000301','18100000-0000-4000-8000-000000000200',
 '18100000-0000-4000-8000-000000000100','18100000-0000-4000-8000-000000000101','2026-08-01',1,
 'platform_subscription',10000,20,2000,1,true,null
);

select is((select settlement_status from public.operator_earnings_ledger where id='18100000-0000-4000-8000-000000000300'), 'accrued'::public.settlement_status, 'new operator row starts accrued');
select is((select settlement_status from public.referral_ledger where id='18100000-0000-4000-8000-000000000301'), 'accrued'::public.settlement_status, 'new referral row starts accrued');
select throws_ok($$update public.operator_earnings_ledger set settlement_status='exported' where id='18100000-0000-4000-8000-000000000300'$$, '55000', 'REVENUE_LEDGER_APPEND_ONLY', 'direct operator status update fails');
select throws_ok($$update public.referral_ledger set amount_cents=2001 where id='18100000-0000-4000-8000-000000000301'$$, '55000', 'REVENUE_LEDGER_APPEND_ONLY', 'direct referral amount update fails');
select lives_ok($$select public.revenue_mark_settlement('operator','18100000-0000-4000-8000-000000000300','accrued','exported','18100000-0000-4000-8000-000000000001')$$, 'admin exports operator row');
select is((select settlement_status from public.operator_earnings_ledger where id='18100000-0000-4000-8000-000000000300'), 'exported'::public.settlement_status, 'operator export persists');
select is((select count(*)::integer from public.audit_log where action='billing.settlement_changed' and subject_id='18100000-0000-4000-8000-000000000300'), 1, 'operator export writes one audit');
select is((public.revenue_mark_settlement('operator','18100000-0000-4000-8000-000000000300','accrued','exported','18100000-0000-4000-8000-000000000001')->>'reason_code'), 'stale', 'stale replay is closed');
select is((select count(*)::integer from public.audit_log where action='billing.settlement_changed' and subject_id='18100000-0000-4000-8000-000000000300'), 1, 'stale replay adds no audit');
select lives_ok($$select public.revenue_mark_settlement('operator','18100000-0000-4000-8000-000000000300','exported','paid','18100000-0000-4000-8000-000000000001')$$, 'admin marks exported operator row paid');
select is((select count(*)::integer from public.audit_log where action='billing.settlement_changed' and subject_id='18100000-0000-4000-8000-000000000300'), 2, 'paid transition adds one audit');
select lives_ok($$select public.revenue_mark_settlement('referral','18100000-0000-4000-8000-000000000301','accrued','exported','18100000-0000-4000-8000-000000000001')$$, 'admin exports referral row');
select is((select settlement_status from public.referral_ledger where id='18100000-0000-4000-8000-000000000301'), 'exported'::public.settlement_status, 'referral export persists');
select throws_ok($$select public.revenue_mark_settlement('referral','18100000-0000-4000-8000-000000000301','exported','reversed','18100000-0000-4000-8000-000000000001')$$, '22023', 'SETTLEMENT_TRANSITION_INVALID', 'admin cannot write reversed');
select throws_ok($$select public.revenue_mark_settlement('referral','18100000-0000-4000-8000-000000000301','exported','paid','18100000-0000-4000-8000-000000000002')$$, '42501', 'SETTLEMENT_PLATFORM_ADMIN_REQUIRED', 'operator cannot mark settlement');
select is((public.revenue_read_settlement_status('operator','18100000-0000-4000-8000-000000000300')->>'status'), 'paid', 'settlement reader returns paid');
select is(public.revenue_read_settlement_status('operator','18100000-0000-4000-8000-000000000399'), null::jsonb, 'settlement reader returns null for absent row');

insert into public.operator_subscriptions(org_id,provider,customer_ref,subscription_ref,base_price_ref,seat_price_ref,status)
values ('18100000-0000-4000-8000-000000000101','mock','cus_refund_181','sub_refund_181','base_181','seat_181','active');
insert into public.stripe_webhook_events(event_id,event_type) values
 ('evt_refund_181_later','charge.refunded'),
 ('evt_refund_181_earlier','charge.refunded'),
 ('evt_refund_181_duplicate','charge.refunded'),
 ('evt_refund_181_unattributed','charge.refunded'),
 ('evt_refund_181_wrong','invoice.paid');

select is((public.billing_record_refund_observation('evt_refund_181_later','ch_181','cus_refund_181','sub_refund_181',2500,'usd','2026-08-15T00:00:00Z')->>'reason_code'), 'recorded', 'later cumulative refund records first');
select is((public.billing_record_refund_observation('evt_refund_181_earlier','ch_181','cus_refund_181','sub_refund_181',1000,'usd','2026-08-10T00:00:00Z')->>'reason_code'), 'recorded', 'earlier cumulative refund may arrive later');
select is(public.revenue_read_refund_total('18100000-0000-4000-8000-000000000101','2026-08-01'), 2500::bigint, 'out-of-order cumulative observations total 2500 once');
select is((public.billing_record_refund_observation('evt_refund_181_later','ch_181','cus_refund_181','sub_refund_181',2500,'usd','2026-08-15T00:00:00Z')->>'reason_code'), 'duplicate', 'event replay is a stable duplicate');
select is((select count(*)::integer from public.billing_refund_observations where charge_ref='ch_181'), 2, 'replay adds no observation');
select is((public.billing_record_refund_observation('evt_refund_181_unattributed','ch_unattributed_181',null,null,700,'usd','2026-08-18T00:00:00Z')->>'attributed'), 'false', 'unattributed evidence is retained');
select is(public.revenue_read_refund_total('18100000-0000-4000-8000-000000000101','2026-08-01'), 2500::bigint, 'unattributed evidence contributes to no org');
select throws_ok($$select public.billing_record_refund_observation('evt_refund_181_wrong','ch_wrong_181',null,null,100,'usd','2026-08-18T00:00:00Z')$$, '22023', 'REFUND_OBSERVATION_INVALID', 'non-refund global event is rejected');
select throws_ok($$select public.billing_record_refund_observation('evt_refund_181_duplicate','ch_bad_181',null,null,-1,'usd','2026-08-18T00:00:00Z')$$, '22023', 'REFUND_OBSERVATION_INVALID', 'negative cumulative amount is rejected');
select throws_ok($$update public.billing_refund_observations set cumulative_amount_refunded_cents=0 where event_id='evt_refund_181_later'$$, 'P0001', 'billing_refund_observations rows are append-only', 'refund observations cannot update');
select is((select refund_amount_cents from public.revenue_read_accrual_inputs('18100000-0000-4000-8000-000000000101','2026-08-01')), 2500::bigint, 'accrual input adds exact refund amount');
select is((select count(*)::integer from public.billing_refund_observations where org_id='18100000-0000-4000-8000-000000000101' and currency='usd'), 2, 'only two attributed refund observations exist');

select * from finish();
rollback;
