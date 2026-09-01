begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.orgs (id, name, slug)
values ('27300000-0000-4000-8000-000000000001', 'R2A Audit Org', 'r2a-audit-org');

insert into auth.users (id, email, raw_app_meta_data)
values
  ('27300000-0000-4000-8000-000000000011', 'platform-r2a09@test.example', '{"app_role":"platform_admin"}'),
  ('27300000-0000-4000-8000-000000000012', 'owner-r2a09@test.example', '{"app_role":"operator_member","org_id":"27300000-0000-4000-8000-000000000001","org_role":"owner"}'),
  ('27300000-0000-4000-8000-000000000013', 'affiliate-r2a09@test.example', '{"app_role":"affiliate","org_id":"27300000-0000-4000-8000-000000000001"}');

insert into public.affiliates (id, org_id, profile_id, name, referral_slug)
values (
  '27300000-0000-4000-8000-000000000021',
  '27300000-0000-4000-8000-000000000001',
  '27300000-0000-4000-8000-000000000013',
  'R2A Audit Affiliate', 'r2a-audit-affiliate'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27300000-0000-4000-8000-000000000011"}';
select throws_ok(
  $$insert into public.audit_log (actor_profile_id, action, subject_type, subject_id)
    values ('27300000-0000-4000-8000-000000000011','billing.settlement_changed','settlement','27300000-0000-4000-8000-000000000901')$$,
  '42501', null, 'platform administrator cannot insert an audit event directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27300000-0000-4000-8000-000000000012"}';
select throws_ok(
  $$insert into public.audit_log (org_id, actor_profile_id, action, subject_type, subject_id)
    values ('27300000-0000-4000-8000-000000000001','27300000-0000-4000-8000-000000000012','billing.settlement_changed','settlement','27300000-0000-4000-8000-000000000902')$$,
  '42501', null, 'operator cannot insert an audit event directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27300000-0000-4000-8000-000000000013"}';
select throws_ok(
  $$insert into public.audit_log (org_id, actor_profile_id, action, subject_type, subject_id)
    values ('27300000-0000-4000-8000-000000000001','27300000-0000-4000-8000-000000000013','billing.settlement_changed','settlement','27300000-0000-4000-8000-000000000903')$$,
  '42501', null, 'affiliate cannot insert an audit event directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27300000-0000-4000-8000-000000000012"}';

insert into public.clients (id, org_id, display_name, assigned_to)
values ('27300000-0000-4000-8000-000000000101','27300000-0000-4000-8000-000000000001','R2A Audit Client','27300000-0000-4000-8000-000000000012');
update public.clients set goal_cents = 5000000 where id = '27300000-0000-4000-8000-000000000101';
update public.orgs set assignment_mode = 'round_robin' where id = '27300000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.fees_set_agreement(
    '27300000-0000-4000-8000-000000000101','percentage',10,null,null,null,null,'active'
  )$$,
  'fee agreement mutation succeeds with database-owned audit attribution'
);
select public.fees_set_org_default(
  '27300000-0000-4000-8000-000000000001','percentage',10,null,null,null,null
);
select public.fees_record_payment(
  '27300000-0000-4000-8000-000000000101',2500,current_date,'bank_transfer',null,null
);
select public.affiliate_share_client(
  '27300000-0000-4000-8000-000000000021','27300000-0000-4000-8000-000000000101'
);
select public.affiliate_update_share(
  '27300000-0000-4000-8000-000000000021','27300000-0000-4000-8000-000000000101',
  '{"expectedCommissionCents":1250,"paymentStatus":"pending"}'::jsonb
);
select public.affiliate_unshare_client(
  '27300000-0000-4000-8000-000000000021','27300000-0000-4000-8000-000000000101'
);

select results_eq(
  $$
    select action, count(*)::bigint
    from public.audit_log
    where actor_profile_id = '27300000-0000-4000-8000-000000000012'
      and action in (
        'client.created','client.metadata.updated','org.settings.updated',
        'fees.agreement.updated','fees.payment.recorded','fees.org_defaults.updated',
        'affiliate.client_shared','affiliate.share_updated','affiliate.client_unshared'
      )
    group by action order by action
  $$,
  $$values
    ('affiliate.client_shared'::text,1::bigint),
    ('affiliate.client_unshared'::text,1::bigint),
    ('affiliate.share_updated'::text,1::bigint),
    ('client.created'::text,1::bigint),
    ('client.metadata.updated'::text,1::bigint),
    ('fees.agreement.updated'::text,1::bigint),
    ('fees.org_defaults.updated'::text,1::bigint),
    ('fees.payment.recorded'::text,1::bigint),
    ('org.settings.updated'::text,1::bigint)
  $$,
  'every authenticated audited mutation appends one fixed action in its transaction'
);

select * from finish();
rollback;
