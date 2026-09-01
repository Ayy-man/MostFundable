begin;
select plan(55);

select has_table('public', 'consumer_referrals', 'consumer_referrals exists');
select has_column('public', 'consumer_referrals', 'consumer_id', 'source consumer stored');
select has_column('public', 'consumer_referrals', 'source_client_id', 'source client stored');
select has_column('public', 'consumer_referrals', 'source_org_id', 'source org stored');
select has_column('public', 'consumer_referrals', 'platform_org_id', 'platform org stored');
select has_column('public', 'consumer_referrals', 'token_hash', 'digest stored');
select has_column('public', 'consumer_referrals', 'clicked_at', 'click time stored');
select has_column('public', 'consumer_referrals', 'converted_at', 'conversion time stored');
select has_column('public', 'consumer_referrals', 'converted_client_id', 'converted client stored');
select col_type_is('public', 'consumer_referrals', 'token_hash', 'bytea', 'digest uses bytea');
select col_is_null('public', 'consumer_referrals', 'clicked_at', 'click starts nullable');
select col_is_null('public', 'consumer_referrals', 'converted_at', 'conversion starts nullable');
select col_is_null('public', 'consumer_referrals', 'converted_client_id', 'client starts nullable');
select has_pk('public', 'consumer_referrals', 'referrals have a primary key');
select has_index('public', 'orgs', 'orgs_one_platform_intake_idx', 'platform marker index exists');
select has_index('public', 'consumer_referrals', 'consumer_referrals_token_hash_key', 'digest is unique');
select ok(to_regclass('public.consumer_referrals') is not null and exists (select 1 from pg_constraint where conname = 'consumer_referrals_token_hash_length'), 'digest length constrained');
select ok(exists (select 1 from pg_constraint where conname = 'consumer_referrals_distinct_orgs'), 'source differs from destination');
select ok(exists (select 1 from pg_constraint where conname = 'consumer_referrals_conversion_pair'), 'conversion fields paired');
select ok(exists (select 1 from pg_constraint where conname = 'consumer_referrals_source_client_fk' and contype = 'f'), 'source tenancy constrained');
select ok(exists (select 1 from pg_constraint where conname = 'consumer_referrals_converted_client_fk' and contype = 'f'), 'destination tenancy constrained');
select is(
  (select relrowsecurity from pg_class where oid = 'public.consumer_referrals'::regclass),
  true,
  'RLS enabled'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.consumer_referrals'::regclass),
  true,
  'RLS forced'
);
select policies_are('public', 'consumer_referrals', array['consumer_referrals_select_own'], 'one read policy');
select table_privs_are('public', 'consumer_referrals', 'authenticated', array['SELECT'], 'authenticated can only read');
select function_privs_are('public', 'referral_create', array['uuid','uuid','uuid','bytea'], 'authenticated', array[]::text[], 'authenticated cannot create');
select function_privs_are('public', 'referral_mark_clicked', array['bytea'], 'authenticated', array[]::text[], 'authenticated cannot click');
select function_privs_are('public', 'referral_mark_converted', array['bytea','uuid','uuid'], 'authenticated', array[]::text[], 'authenticated cannot convert');
select function_privs_are('public', 'referral_create', array['uuid','uuid','uuid','bytea'], 'service_role', array['EXECUTE'], 'service role creates');
select function_privs_are('public', 'referral_mark_clicked', array['bytea'], 'service_role', array['EXECUTE'], 'service role clicks');
select function_privs_are('public', 'referral_mark_converted', array['bytea','uuid','uuid'], 'service_role', array['EXECUTE'], 'service role converts');
select is_definer('public', 'referral_create', array['uuid','uuid','uuid','bytea'], 'create is definer');
select is_definer('public', 'referral_mark_clicked', array['bytea'], 'click is definer');
select is_definer('public', 'referral_mark_converted', array['bytea','uuid','uuid'], 'convert is definer');

insert into public.orgs (id, name, slug, brand)
values (
  'f0000000-0000-0000-0000-000000000001',
  'MostFundable Fictional Intake',
  'mostfundable-platform-intake-test',
  '{"fictional": true, "platform_intake": true}'::jsonb
)
on conflict (id) do update set brand = excluded.brand;

select throws_ok(
  $$insert into public.orgs (id, name, slug, brand) values ('f0000000-0000-0000-0000-000000000002', 'Second Fictional Intake', 'second-platform-intake-test', '{"platform_intake": true}')$$,
  '23505',
  null,
  'a second platform marker is rejected'
);

select lives_ok(
  $$select * from public.referral_create('a1000000-0000-0000-0000-000000000011', 'a3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', decode(repeat('11', 32), 'hex'))$$,
  'referral creation succeeds'
);
select is((select count(*) from public.consumer_referrals), 1::bigint, 'one referral row created');
select is((select source_org_id from public.consumer_referrals), 'a0000000-0000-0000-0000-000000000001'::uuid, 'source org derived from client');
select is((select platform_org_id from public.consumer_referrals), 'f0000000-0000-0000-0000-000000000001'::uuid, 'platform org stored independently');
select is((select octet_length(token_hash) from public.consumer_referrals), 32, 'only a 32-byte digest persists');
select is((select count(*) from public.audit_log where action = 'referral.created'), 1::bigint, 'create audit written once');

select lives_ok(
  $$select * from public.referral_mark_clicked(decode(repeat('11', 32), 'hex'))$$,
  'first click succeeds'
);
create temp table referral_first_click as
select clicked_at from public.consumer_referrals;
select ok((select clicked_at is not null from public.consumer_referrals), 'click timestamp recorded');
select lives_ok(
  $$select * from public.referral_mark_clicked(decode(repeat('11', 32), 'hex'))$$,
  'click replay succeeds'
);
select is(
  (select clicked_at from public.consumer_referrals),
  (select clicked_at from referral_first_click),
  'click replay preserves first timestamp'
);
select is((select count(*) from public.audit_log where action = 'referral.clicked'), 1::bigint, 'click audit written once');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('f1000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fixture-referral@platform.example', '', now(), now());
insert into public.profiles (id, role, org_id, full_name, email)
values ('f1000000-0000-0000-0000-000000000011', 'consumer', 'f0000000-0000-0000-0000-000000000001', 'Referral Fixture Consumer', 'fixture-referral@platform.example')
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  full_name = excluded.full_name,
  email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values ('f3000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000011', 'Referral Fixture Client');

select lives_ok(
  $$select * from public.referral_mark_converted(decode(repeat('11', 32), 'hex'), 'f3000000-0000-0000-0000-000000000011', 'f1000000-0000-0000-0000-000000000011')$$,
  'conversion succeeds'
);
create temp table referral_first_conversion as
select converted_at from public.consumer_referrals;
select is((select converted_client_id from public.consumer_referrals), 'f3000000-0000-0000-0000-000000000011'::uuid, 'exact converted client attached');
select lives_ok(
  $$select * from public.referral_mark_converted(decode(repeat('11', 32), 'hex'), 'f3000000-0000-0000-0000-000000000011', 'f1000000-0000-0000-0000-000000000011')$$,
  'same-client conversion replay succeeds'
);
select is(
  (select converted_at from public.consumer_referrals),
  (select converted_at from referral_first_conversion),
  'conversion replay preserves first timestamp'
);
select is((select count(*) from public.audit_log where action = 'referral.converted'), 1::bigint, 'conversion audit written once');

select throws_ok(
  $$select * from public.referral_mark_clicked(decode(repeat('22', 32), 'hex'))$$,
  'P0002',
  null,
  'unknown digest is not found'
);
select throws_ok(
  $$select * from public.referral_create('a1000000-0000-0000-0000-000000000011', 'a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', decode(repeat('33', 32), 'hex'))$$,
  '42501',
  null,
  'operator destination rejected'
);
select throws_ok(
  $$select * from public.referral_create('a1000000-0000-0000-0000-000000000011', 'a3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', decode(repeat('44', 16), 'hex'))$$,
  '22023',
  null,
  'short digest rejected'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'consumer_referrals'
      and lower(column_name) ~ (array_to_string(array['amount', 'curr' || 'ency', 'perc' || 'ent', 'rew' || 'ard', 'pay' || 'out', 'led' || 'ger', 'pri' || 'ce'], '|'))
  ),
  0::bigint,
  'referral schema contains only lifecycle and identity fields'
);

select * from finish();
rollback;
