begin;

set local search_path = public, extensions;

select plan(23);

insert into public.orgs (id, name, slug) values
  ('21100000-0000-4000-8000-000000000001', 'Attribution Org A', 'attribution-org-a'),
  ('21100000-0000-4000-8000-000000000002', 'Attribution Org B', 'attribution-org-b');
insert into auth.users (id, email, raw_app_meta_data) values
  ('21100000-0000-4000-8000-000000000011', 'actor@attribution.test', '{"app_role":"consumer","org_id":"21100000-0000-4000-8000-000000000001","full_name":"Actor A"}'),
  ('21100000-0000-4000-8000-000000000012', 'affiliate-a@attribution.test', '{"app_role":"affiliate","org_id":"21100000-0000-4000-8000-000000000001","full_name":"Affiliate A"}'),
  ('21100000-0000-4000-8000-000000000022', 'affiliate-b@attribution.test', '{"app_role":"affiliate","org_id":"21100000-0000-4000-8000-000000000002","full_name":"Affiliate B"}');
insert into public.affiliates (id, org_id, profile_id, name, referral_slug) values
  ('21100000-0000-4000-8000-000000000101', '21100000-0000-4000-8000-000000000001', '21100000-0000-4000-8000-000000000012', 'Affiliate A', 'affiliate-a-code'),
  ('21100000-0000-4000-8000-000000000102', '21100000-0000-4000-8000-000000000001', null, 'Affiliate A2', 'affiliate-a2-code'),
  ('21100000-0000-4000-8000-000000000201', '21100000-0000-4000-8000-000000000002', '21100000-0000-4000-8000-000000000022', 'Affiliate B', 'affiliate-b-code');
insert into public.clients (id, org_id, consumer_profile_id, display_name) values
  ('21100000-0000-4000-8000-000000000301', '21100000-0000-4000-8000-000000000001', '21100000-0000-4000-8000-000000000011', 'Valid Client'),
  ('21100000-0000-4000-8000-000000000302', '21100000-0000-4000-8000-000000000001', null, 'Unknown Client'),
  ('21100000-0000-4000-8000-000000000303', '21100000-0000-4000-8000-000000000001', null, 'Wrong Org Client'),
  ('21100000-0000-4000-8000-000000000304', '21100000-0000-4000-8000-000000000001', null, 'Rollback Client'),
  ('21100000-0000-4000-8000-000000000305', '21100000-0000-4000-8000-000000000001', null, 'Legacy Client');

select is(public.affiliate_referral_valid('affiliate-a-code'), true, 'known referral code is valid');
select is(public.affiliate_referral_valid('unknown-code'), false, 'unknown referral code is invalid');
select is(public.affiliate_referral_valid('   '), false, 'blank referral code is invalid');
select is(public.affiliate_referral_valid(repeat('x', 256)), false, 'oversized referral code is invalid');
select ok(has_function_privilege('anon', 'public.affiliate_referral_valid(text)', 'execute'), 'anon can call only the boolean probe');
select ok(not has_function_privilege('authenticated', 'public.enrollment_begin(uuid,uuid,uuid,text,text,text,text,text,inet,text,text)', 'execute'), 'authenticated cannot call enrollment creation');

set local role service_role;
select lives_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000301', '21100000-0000-4000-8000-000000000011', '21100000-0000-4000-8000-000000000401', 'Valid Signer', 'Valid Signer', 'agreement-v1', 'monitoring-v1', 'analysis-v1', '127.0.0.1', 'pgtap', 'affiliate-a-code')$$, 'valid same-org attribution enrolls');
reset role;
select is((select affiliate_id from public.clients where id = '21100000-0000-4000-8000-000000000301'), '21100000-0000-4000-8000-000000000101'::uuid, 'valid code sets the client affiliate FK');
select is((select count(*)::integer from public.affiliate_client_shares where affiliate_id = '21100000-0000-4000-8000-000000000101' and client_id = '21100000-0000-4000-8000-000000000301'), 1, 'valid code creates one default share');

set local role service_role;
select lives_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000302', null, '21100000-0000-4000-8000-000000000402', 'Unknown Signer', 'Unknown Signer', 'agreement-v1', 'monitoring-v1', 'analysis-v1', '127.0.0.1', 'pgtap', 'unknown-code')$$, 'unknown code never blocks enrollment');
reset role;
select is((select affiliate_id from public.clients where id = '21100000-0000-4000-8000-000000000302'), null::uuid, 'unknown code leaves attribution empty');

set local role service_role;
select lives_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000303', null, '21100000-0000-4000-8000-000000000403', 'Wrong Org Signer', 'Wrong Org Signer', 'agreement-v1', 'monitoring-v1', 'analysis-v1', '127.0.0.1', 'pgtap', 'affiliate-b-code')$$, 'wrong-org code never blocks enrollment');
reset role;
select is((select affiliate_id from public.clients where id = '21100000-0000-4000-8000-000000000303'), null::uuid, 'wrong-org code leaves attribution empty');

set local role service_role;
select throws_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000304', null, '21100000-0000-4000-8000-000000000404', 'Rollback Signer', 'Rollback Signer', 'agreement-v1', null, 'analysis-v1', '127.0.0.1', 'pgtap', 'affiliate-a-code')$$, '23502', null, 'a later enrollment failure is surfaced');
reset role;
select is((select affiliate_id from public.clients where id = '21100000-0000-4000-8000-000000000304'), null::uuid, 'failed enrollment rolls back the client FK');
select is((select count(*)::integer from public.affiliate_client_shares where client_id = '21100000-0000-4000-8000-000000000304'), 0, 'failed enrollment rolls back the share');

set local role service_role;
select lives_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000301', '21100000-0000-4000-8000-000000000011', '21100000-0000-4000-8000-000000000401', 'Valid Signer', 'Valid Signer', 'agreement-v1', 'monitoring-v1', 'analysis-v1', '127.0.0.1', 'pgtap', 'affiliate-a2-code')$$, 'completed draft replay succeeds');
reset role;
select is((select affiliate_id from public.clients where id = '21100000-0000-4000-8000-000000000301'), '21100000-0000-4000-8000-000000000101'::uuid, 'completed draft replay does not reassign attribution');

set local role service_role;
select lives_ok($$select public.enrollment_begin('21100000-0000-4000-8000-000000000305', null, '21100000-0000-4000-8000-000000000405', 'Legacy Signer', 'Legacy Signer', 'agreement-v1', 'monitoring-v1', 'analysis-v1', '127.0.0.1', 'pgtap')$$, 'ten-argument compatibility wrapper remains callable');
reset role;
select is((select count(*)::integer from public.enrollments where client_id = '21100000-0000-4000-8000-000000000305'), 1, 'legacy wrapper preserves enrollment behavior');

select results_eq(
  $$select column_name::text collate "C" from information_schema.columns where table_schema = 'public' and table_name = 'affiliate_client_view' order by ordinal_position$$,
  $$values ('started_at'::text collate "C"), ('stage'::text collate "C"), ('funded_amount_cents'::text collate "C"), ('expected_commission_cents'::text collate "C"), ('payment_status'::text collate "C")$$,
  'affiliate view remains exactly five ordered columns'
);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21100000-0000-4000-8000-000000000012"}';
select is((select count(*)::integer from public.affiliate_client_view), 1, 'affiliate sees the attributed row through the projection');
select is((select count(*)::integer from public.clients), 0, 'affiliate has no direct client base-table read path');
reset role;

select * from finish();
rollback;
