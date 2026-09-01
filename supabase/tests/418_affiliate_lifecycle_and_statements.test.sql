begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

select has_column('public', 'affiliates', 'default_commission_bps', 'affiliate carries a durable commission default');
select has_column('public', 'affiliate_client_shares', 'commission_override', 'share records distinguish an explicit amount from the default');
select col_default_is(
  'public', 'affiliate_client_shares', 'commission_override', false,
  'shares created after the migration follow the calculated default until explicitly overridden'
);
select col_not_null(
  'public', 'affiliate_client_shares', 'commission_override',
  'every share records whether its amount is calculated or explicit'
);
select function_privs_are(
  'public', 'operator_affiliate_roster', array[]::text[], 'authenticated', array['EXECUTE'],
  'only authenticated callers receive the roster entry point'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.affiliate_expected_commission(bigint,integer)', 'execute'
  ),
  'authenticated callers cannot execute the private commission helper'
);
select ok(
  not (
    select proc.prosecdef
    from pg_catalog.pg_proc as proc
    where proc.oid = 'public.affiliate_share_client(uuid,uuid)'::pg_catalog.regprocedure
  )
  and not (
    select proc.prosecdef
    from pg_catalog.pg_proc as proc
    where proc.oid = 'public.affiliate_update_share(uuid,uuid,jsonb)'::pg_catalog.regprocedure
  ),
  'the public share mutations keep RLS as their authorization boundary'
);

insert into public.orgs (id, name, slug) values
  ('41800000-0000-4000-8000-000000000001', 'Affiliate Lifecycle Org', 'affiliate-lifecycle-org'),
  ('41800000-0000-4000-8000-000000000002', 'Other Affiliate Org', 'other-affiliate-lifecycle-org');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  (
    '41800000-0000-4000-8000-000000000011', 'owner@affiliate-lifecycle.test',
    '{"app_role":"operator_member","org_id":"41800000-0000-4000-8000-000000000001","org_role":"owner"}',
    '{"full_name":"Lifecycle Owner"}'
  ),
  (
    '41800000-0000-4000-8000-000000000012', 'member@affiliate-lifecycle.test',
    '{"app_role":"operator_member","org_id":"41800000-0000-4000-8000-000000000001","org_role":"prep_specialist"}',
    '{"full_name":"Lifecycle Member"}'
  ),
  (
    '41800000-0000-4000-8000-000000000013', 'partner@affiliate-lifecycle.test',
    '{"app_role":"affiliate","org_id":"41800000-0000-4000-8000-000000000001"}',
    '{"full_name":"Lifecycle Partner"}'
  ),
  (
    '41800000-0000-4000-8000-000000000014', 'other-partner@affiliate-lifecycle.test',
    '{"app_role":"affiliate","org_id":"41800000-0000-4000-8000-000000000002"}',
    '{"full_name":"Other Partner"}'
  );

insert into public.affiliates (id, org_id, profile_id, name, referral_slug) values
  ('41800000-0000-4000-8000-000000000021', '41800000-0000-4000-8000-000000000001', '41800000-0000-4000-8000-000000000013', 'Lifecycle Partner', 'lifecycle-partner'),
  ('41800000-0000-4000-8000-000000000022', '41800000-0000-4000-8000-000000000002', '41800000-0000-4000-8000-000000000014', 'Other Partner', 'other-lifecycle-partner');

insert into public.clients (id, org_id, display_name) values
  ('41800000-0000-4000-8000-000000000031', '41800000-0000-4000-8000-000000000001', 'Commission Client');

insert into public.applications (id, client_id, bank_ref, created_by) values
  (
    '41800000-0000-4000-8000-000000000041',
    '41800000-0000-4000-8000-000000000031',
    'bluevine',
    '41800000-0000-4000-8000-000000000011'
  ),
  (
    '41800000-0000-4000-8000-000000000042',
    '41800000-0000-4000-8000-000000000031',
    'chase-ink',
    '41800000-0000-4000-8000-000000000011'
  ),
  (
    '41800000-0000-4000-8000-000000000043',
    '41800000-0000-4000-8000-000000000031',
    'amex-business',
    '41800000-0000-4000-8000-000000000011'
  );

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000011"}';

select is(
  (select name || ':' || active::text || ':' || default_commission_bps::text from public.operator_affiliate_roster()),
  'Lifecycle Partner:true:0',
  'the operator roster returns only the signed-in organization and its live lifecycle state'
);

select is(
  (select changed::text || ':' || default_commission_bps::text from public.operator_affiliate_update(
    '41800000-0000-4000-8000-000000000021', '{"defaultCommissionBps":1000}'::jsonb
  )),
  'true:1000',
  'an owner can set the affiliate commission percentage'
);

select public.record_outcome(
  '41800000-0000-4000-8000-000000000041',
  'approved',
  1000000,
  current_date,
  null
);

select is(
  (select expected_commission_cents from public.affiliate_share_client(
    '41800000-0000-4000-8000-000000000021', '41800000-0000-4000-8000-000000000031'
  )),
  100000::bigint,
  'a new share derives its expected commission from recorded funding'
);

select public.record_outcome(
  '41800000-0000-4000-8000-000000000042',
  'approved',
  1000000,
  current_date,
  null
);
select is(
  (select expected_commission_cents from public.affiliate_client_shares
    where affiliate_id = '41800000-0000-4000-8000-000000000021'
      and client_id = '41800000-0000-4000-8000-000000000031'),
  200000::bigint,
  'recorded funding changes recalculate a non-overridden share'
);

select is(
  (select changed from public.affiliate_update_share(
    '41800000-0000-4000-8000-000000000021', '41800000-0000-4000-8000-000000000031',
    '{"expectedCommissionCents":12345}'::jsonb
  )),
  true,
  'an operator can record an explicit per-client commission'
);
select public.record_outcome(
  '41800000-0000-4000-8000-000000000043',
  'approved',
  1000000,
  current_date,
  null
);
select results_eq(
  $$select expected_commission_cents, commission_override from public.affiliate_client_shares
    where affiliate_id = '41800000-0000-4000-8000-000000000021'
      and client_id = '41800000-0000-4000-8000-000000000031'$$,
  $$values (12345::bigint, true)$$,
  'a later funding outcome does not overwrite an explicit commission'
);

select is(
  (select expected_commission_cents from public.affiliate_update_share(
    '41800000-0000-4000-8000-000000000021', '41800000-0000-4000-8000-000000000031',
    '{"expectedCommissionCents":null}'::jsonb
  )),
  300000::bigint,
  'clearing the explicit amount returns the share to its calculated default'
);
select is(
  (select commission_override from public.affiliate_client_shares
    where affiliate_id = '41800000-0000-4000-8000-000000000021'
      and client_id = '41800000-0000-4000-8000-000000000031'),
  false,
  'resetting the amount clears the override marker'
);

select results_eq(
  $$select client_name, funded_amount_cents, expected_commission_cents, commission_override
    from public.operator_affiliate_statement('41800000-0000-4000-8000-000000000021')$$,
  $$values ('Commission Client'::text, 3000000::bigint, 300000::bigint, false)$$,
  'the statement reads the real client funding and commission ledger'
);

select is(
  (select active from public.operator_affiliate_update(
    '41800000-0000-4000-8000-000000000021', '{"active":false}'::jsonb
  )),
  false,
  'an owner can deactivate an affiliate'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000013"}';
select is(
  (select private.auth_app_role()::text),
  null,
  'profile disablement closes the shared authentication role for that affiliate'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000011"}';
select is(
  (select active from public.operator_affiliate_update(
    '41800000-0000-4000-8000-000000000021', '{"active":true}'::jsonb
  )),
  true,
  'the same governed path can reactivate the affiliate'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000013"}';
select is(
  (select count(*) from public.affiliate_client_view),
  1::bigint,
  'reactivation restores the affiliate owner-context statement'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000012"}';
select throws_ok(
  $$select * from public.operator_affiliate_update(
    '41800000-0000-4000-8000-000000000021', '{"defaultCommissionBps":500}'::jsonb
  )$$,
  '42501', 'AFFILIATE_UPDATE_FORBIDDEN',
  'a non-admin member cannot change affiliate commercial terms'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"41800000-0000-4000-8000-000000000011"}';
select throws_ok(
  $$select * from public.operator_affiliate_statement('41800000-0000-4000-8000-000000000022')$$,
  'P0002', 'AFFILIATE_NOT_FOUND',
  'another organization affiliate is indistinguishable from a missing record'
);

select is(
  (select count(*) from public.audit_log
    where subject_id = '41800000-0000-4000-8000-000000000021'
      and action in ('affiliate.settings_updated', 'affiliate.deactivated', 'affiliate.reactivated')),
  3::bigint,
  'commission and lifecycle changes append their audit evidence'
);

select * from finish();
rollback;
