begin;

set local search_path = public, extensions;

select plan(27);

insert into public.orgs (id, name, slug, team_sees_all_clients) values
  ('21000000-0000-4000-8000-000000000001', 'Affiliate Test Org A', 'affiliate-test-a', false),
  ('21000000-0000-4000-8000-000000000002', 'Affiliate Test Org B', 'affiliate-test-b', false);

insert into auth.users (id, email, raw_app_meta_data) values
  ('21000000-0000-4000-8000-000000000011', 'owner-a@affiliate.test', '{"app_role":"operator_member","org_id":"21000000-0000-4000-8000-000000000001","org_role":"owner","full_name":"Owner A"}'),
  ('21000000-0000-4000-8000-000000000012', 'specialist-a@affiliate.test', '{"app_role":"operator_member","org_id":"21000000-0000-4000-8000-000000000001","org_role":"prep_specialist","full_name":"Specialist A"}'),
  ('21000000-0000-4000-8000-000000000013', 'affiliate-a@affiliate.test', '{"app_role":"affiliate","org_id":"21000000-0000-4000-8000-000000000001","full_name":"Affiliate A"}'),
  ('21000000-0000-4000-8000-000000000014', 'consumer-a@affiliate.test', '{"app_role":"consumer","org_id":"21000000-0000-4000-8000-000000000001","full_name":"Consumer A"}'),
  ('21000000-0000-4000-8000-000000000021', 'owner-b@affiliate.test', '{"app_role":"operator_member","org_id":"21000000-0000-4000-8000-000000000002","org_role":"owner","full_name":"Owner B"}');

insert into public.affiliates (id, org_id, profile_id, name, referral_slug) values
  ('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000013', 'Generated Affiliate', null),
  ('21000000-0000-4000-8000-000000000102', '21000000-0000-4000-8000-000000000001', null, 'Explicit Affiliate', 'existing-affiliate-code'),
  ('21000000-0000-4000-8000-000000000201', '21000000-0000-4000-8000-000000000002', null, 'Foreign Affiliate', 'foreign-affiliate-code');

insert into public.clients (id, org_id, display_name, assigned_to) values
  ('21000000-0000-4000-8000-000000000301', '21000000-0000-4000-8000-000000000001', 'Accessible Client', '21000000-0000-4000-8000-000000000012'),
  ('21000000-0000-4000-8000-000000000302', '21000000-0000-4000-8000-000000000001', 'Owner Client', null),
  ('21000000-0000-4000-8000-000000000401', '21000000-0000-4000-8000-000000000002', 'Foreign Client', null);

select matches(
  (select referral_slug from public.affiliates where id = '21000000-0000-4000-8000-000000000101'),
  '^[a-z0-9]{8}$',
  'missing affiliate slug is generated in the required shape'
);
select is(
  (select referral_slug from public.affiliates where id = '21000000-0000-4000-8000-000000000102'),
  'existing-affiliate-code',
  'an explicit existing-format slug is preserved'
);
select enum_has_labels(
  'public', 'affiliate_payment_status',
  array['not_ready', 'pending', 'submitted', 'paid'],
  'the existing four-state payment enum remains authoritative'
);
select ok(has_function_privilege('authenticated', 'public.affiliate_share_client(uuid,uuid)', 'execute'), 'authenticated may execute share');
select ok(not has_function_privilege('anon', 'public.affiliate_share_client(uuid,uuid)', 'execute'), 'anon may not execute share');
-- 2026-08-17 R2A-09 carry: the share trigger owns the fixed audit actions.
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_affiliate_client_insert'), 0, 'client-anchored direct audit policy is absent');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21000000-0000-4000-8000-000000000011"}';
select is((select inserted from public.affiliate_share_client('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301')), true, 'owner can share an accessible client');
reset role;
select is((select count(*)::integer from public.affiliate_client_shares where affiliate_id = '21000000-0000-4000-8000-000000000101' and client_id = '21000000-0000-4000-8000-000000000301'), 1, 'share row is durable');
select is((select count(*)::integer from public.audit_log where action = 'affiliate.client_shared' and client_id = '21000000-0000-4000-8000-000000000301'), 1, 'first share has one audit row');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21000000-0000-4000-8000-000000000011"}';
select is((select inserted from public.affiliate_share_client('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301')), false, 'share replay is idempotent');
reset role;
select is((select count(*)::integer from public.audit_log where action = 'affiliate.client_shared' and client_id = '21000000-0000-4000-8000-000000000301'), 1, 'share replay adds no audit row');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21000000-0000-4000-8000-000000000012"}';
select is((select changed from public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":0,"paymentStatus":"pending"}')), true, 'assigned specialist can update both manual fields');
reset role;
select is((select expected_commission_cents from public.affiliate_client_shares where affiliate_id = '21000000-0000-4000-8000-000000000101' and client_id = '21000000-0000-4000-8000-000000000301'), 0::bigint, 'zero expected commission is accepted');
select results_eq(
  $$select jsonb_array_elements_text(meta->'field_names') from public.audit_log where action = 'affiliate.share_updated' and client_id = '21000000-0000-4000-8000-000000000301' order by 1$$,
  $$values ('commission_override'::text), ('payment_status'::text)$$,
  'update audit names the changed status and override mode when explicit cents equal the default'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21000000-0000-4000-8000-000000000012"}';
select is((select changed from public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":0,"paymentStatus":"pending"}')), false, 'identical patch is a no-op');
reset role;
select is((select count(*)::integer from public.audit_log where action = 'affiliate.share_updated' and client_id = '21000000-0000-4000-8000-000000000301'), 1, 'identical patch adds no audit row');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"21000000-0000-4000-8000-000000000011"}';
select lives_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"paymentStatus":"not_ready"}')$$, 'not_ready is accepted');
select lives_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"paymentStatus":"submitted"}')$$, 'submitted is accepted');
select lives_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"paymentStatus":"paid"}')$$, 'paid is accepted');
select lives_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":null}')$$, 'null expected commission is accepted');
select throws_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":-1}')$$, '22023', 'invalid affiliate share patch', 'negative expected commission is rejected');
select throws_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":1.5}')$$, '22023', 'invalid affiliate share patch', 'fractional expected commission is rejected');
select throws_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"expectedCommissionCents":9223372036854775808}')$$, '22023', 'invalid affiliate share patch', 'overflow expected commission is rejected');
select throws_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"paymentStatus":"other"}')$$, '22023', 'invalid affiliate share patch', 'unknown payment status is rejected');
select throws_ok($$select public.affiliate_update_share('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301', '{"other":true}')$$, '22023', 'invalid affiliate share patch', 'unknown patch key is rejected');

select is(public.affiliate_unshare_client('21000000-0000-4000-8000-000000000101', '21000000-0000-4000-8000-000000000301'), true, 'owner can unshare an accessible client');
reset role;
select is((select count(*)::integer from public.audit_log where action = 'affiliate.client_unshared' and client_id = '21000000-0000-4000-8000-000000000301'), 1, 'unshare writes one audit row');
select * from finish();
rollback;
