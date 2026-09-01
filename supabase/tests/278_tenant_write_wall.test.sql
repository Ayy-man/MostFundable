begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R2A-14: every authenticated mutation path carries the tenant wall.
select plan(25);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r2a14-bank-a', 'r2a14-bank-b', 'r2a14-bank-c']) as handle
on conflict (bank_ref) do nothing;

select has_function(
  'private', 'tenant_write_allowed', array['uuid']::name[],
  'the database exposes one tenant-write decision'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where policy.polroles @> array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and policy.polcmd in ('a', 'w', 'd', '*')
      and namespace.nspname in ('public', 'storage')
      and (
        (policy.polcmd in ('w', 'd', '*') and coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '') not like '%tenant_write_allowed%')
        or (policy.polcmd in ('a', 'w', '*') and coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') not like '%tenant_write_allowed%')
      )
  ),
  0,
  'every authenticated mutation policy applies the tenant wall to each required predicate'
);

-- 2026-08-17 R3A-02/R3A-04: outcomes no longer accepts authenticated inserts
-- and clients no longer accepts authenticated deletes. Carry the exact
-- remaining table inventory instead of a stale lower-bound count.
select results_eq(
  $$
    select distinct (namespace.nspname || '.' || relation.relname)::text collate "C"
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where policy.polroles @> array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]
      and policy.polcmd in ('a', 'w', 'd', '*')
      and namespace.nspname in ('public', 'storage')
    order by 1
  $$,
  $$values
    ('public.affiliate_client_shares'::text collate "C"),
    ('public.affiliates'::text collate "C"),
    ('public.application_notes'::text collate "C"),
    ('public.applications'::text collate "C"),
    ('public.clients'::text collate "C"),
    ('public.consumer_notification_preferences'::text collate "C"),
    -- 2026-08-25: migration 394 added the consumer notification reads ledger
    -- (own-row insert); 395 conjoined the wall onto its policy.
    ('public.consumer_notification_reads'::text collate "C"),
    ('public.fee_agreements'::text collate "C"),
    ('public.fee_ledger'::text collate "C"),
    ('public.fee_payments'::text collate "C"),
    ('public.invites'::text collate "C"),
    ('public.operator_tasks'::text collate "C"),
    ('public.org_fee_defaults'::text collate "C"),
    ('public.org_flags'::text collate "C"),
    ('public.orgs'::text collate "C"),
    ('public.outcome_notifications'::text collate "C"),
    ('public.profiles'::text collate "C"),
    ('storage.objects'::text collate "C")
  $$,
  'the policy inventory covers every currently writable authenticated table'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = any(array['record_outcome', 'review_outcome', 'set_client_status', 'tracker_transition_client_stage'])
      and proc.prosecdef
      and pg_catalog.pg_get_functiondef(proc.oid) like '%tenant_write_allowed%'
  ),
  4,
  'every authenticated definer mutation wrapper checks the tenant wall'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = any(array[
        'affiliate_share_client', 'affiliate_unshare_client', 'affiliate_update_share',
        'fees_record_payment', 'fees_reverse_payment', 'fees_set_agreement', 'fees_set_org_default'
      ])
      and not proc.prosecdef
      and has_function_privilege('authenticated', proc.oid, 'execute')
  ),
  7,
  'every authenticated invoker mutation RPC remains subject to the walled policies'
);

insert into auth.users(id,email) values
  ('27800000-0000-4000-8000-000000000001','owner@r2a14.test'),
  ('27800000-0000-4000-8000-000000000002','admin@r2a14.test'),
  ('27800000-0000-4000-8000-000000000003','member@r2a14.test'),
  ('27800000-0000-4000-8000-000000000004','affiliate@r2a14.test'),
  ('27800000-0000-4000-8000-000000000005','consumer@r2a14.test'),
  ('27800000-0000-4000-8000-000000000006','current@r2a14.test'),
  ('27800000-0000-4000-8000-000000000007','trial@r2a14.test');

insert into public.orgs(id,name,slug,membership) values
  ('27800000-0000-4000-8000-000000000101','R2A14 Deactivated','r2a14-deactivated','deactivated'),
  ('27800000-0000-4000-8000-000000000102','R2A14 Current','r2a14-current','current'),
  ('27800000-0000-4000-8000-000000000103','R2A14 Trial','r2a14-trial','trial');

insert into public.profiles(id,role,org_id,org_role,full_name,email) values
  ('27800000-0000-4000-8000-000000000001','operator_member','27800000-0000-4000-8000-000000000101','owner','Owner','owner@r2a14.test'),
  ('27800000-0000-4000-8000-000000000002','operator_member','27800000-0000-4000-8000-000000000101','admin','Admin','admin@r2a14.test'),
  ('27800000-0000-4000-8000-000000000003','operator_member','27800000-0000-4000-8000-000000000101','member','Member','member@r2a14.test'),
  ('27800000-0000-4000-8000-000000000004','affiliate','27800000-0000-4000-8000-000000000101',null,'Affiliate','affiliate@r2a14.test'),
  ('27800000-0000-4000-8000-000000000005','consumer','27800000-0000-4000-8000-000000000101',null,'Consumer','consumer@r2a14.test'),
  ('27800000-0000-4000-8000-000000000006','operator_member','27800000-0000-4000-8000-000000000102','owner','Current','current@r2a14.test'),
  ('27800000-0000-4000-8000-000000000007','operator_member','27800000-0000-4000-8000-000000000103','owner','Trial','trial@r2a14.test')
on conflict(id) do update
set role=excluded.role, org_id=excluded.org_id, org_role=excluded.org_role,
    full_name=excluded.full_name, email=excluded.email;

insert into public.clients(id,org_id,display_name) values
  ('27800000-0000-4000-8000-000000000201','27800000-0000-4000-8000-000000000101','Deactivated Client'),
  ('27800000-0000-4000-8000-000000000202','27800000-0000-4000-8000-000000000102','Current Client'),
  ('27800000-0000-4000-8000-000000000203','27800000-0000-4000-8000-000000000103','Trial Client');

insert into public.affiliates(id,org_id,profile_id,name,referral_slug) values
  ('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-000000000101','27800000-0000-4000-8000-000000000004','R2A14 Affiliate','r2a14-affiliate');
insert into public.affiliate_client_shares(affiliate_id,client_id,expected_commission_cents,commission_override) values
  ('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-000000000201',1000,true);

insert into public.applications(id,client_id,bank_ref,created_by) values
  ('27800000-0000-4000-8000-000000000401','27800000-0000-4000-8000-000000000201','r2a14-bank-a','27800000-0000-4000-8000-000000000004'),
  ('27800000-0000-4000-8000-000000000402','27800000-0000-4000-8000-000000000201','r2a14-bank-b','27800000-0000-4000-8000-000000000001'),
  ('27800000-0000-4000-8000-000000000403','27800000-0000-4000-8000-000000000201','r2a14-bank-c','27800000-0000-4000-8000-000000000005');
insert into public.outcomes(id,application_id,bank_ref,client_id,kind,amount_cents,recorded_by,recorded_by_kind)
values
  ('27800000-0000-4000-8000-000000000501','27800000-0000-4000-8000-000000000401','r2a14-bank-a','27800000-0000-4000-8000-000000000201','approved',50000,'27800000-0000-4000-8000-000000000004','operator'),
  ('27800000-0000-4000-8000-000000000502','27800000-0000-4000-8000-000000000403','r2a14-bank-c','27800000-0000-4000-8000-000000000201','denied',null,'27800000-0000-4000-8000-000000000005','consumer');
insert into public.outcome_notifications(id,org_id,outcome_id,recipient_profile_id,kind) values
  ('27800000-0000-4000-8000-000000000601','27800000-0000-4000-8000-000000000101','27800000-0000-4000-8000-000000000501','27800000-0000-4000-8000-000000000004','outcome_review_approved'),
  ('27800000-0000-4000-8000-000000000602','27800000-0000-4000-8000-000000000101','27800000-0000-4000-8000-000000000502','27800000-0000-4000-8000-000000000005','outcome_review_approved');
insert into public.fee_agreements(client_id,org_id,model,pct,status,source)
values ('27800000-0000-4000-8000-000000000201','27800000-0000-4000-8000-000000000101','percentage',10,'active','operator_override');
insert into public.fee_payments(id,client_id,org_id,amount_cents,received_on,method,recorded_by)
values ('27800000-0000-4000-8000-000000000701','27800000-0000-4000-8000-000000000201','27800000-0000-4000-8000-000000000101',1000,current_date,'bank_transfer','27800000-0000-4000-8000-000000000001');

set local role authenticated;

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000001')::text, true);
select is_empty($$update public.clients set display_name='owner-write' where id='27800000-0000-4000-8000-000000000201' returning id$$,'a deactivated owner cannot update a client');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000002')::text, true);
select is_empty($$update public.clients set display_name='admin-write' where id='27800000-0000-4000-8000-000000000201' returning id$$,'a deactivated organization admin cannot update a client');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000003')::text, true);
select is_empty($$update public.clients set display_name='member-write' where id='27800000-0000-4000-8000-000000000201' returning id$$,'a deactivated member cannot update a client');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000004')::text, true);
select is_empty($$update public.outcome_notifications set read_at=now() where id='27800000-0000-4000-8000-000000000601' returning id$$,'a deactivated affiliate cannot mutate its notification');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$select public.set_client_status('27800000-0000-4000-8000-000000000201','archived','27800000-0000-4000-8000-000000000001')$$,'42501',null,'the status definer rejects a deactivated tenant');
select throws_ok($$select public.tracker_transition_client_stage('27800000-0000-4000-8000-000000000201','applying','onboarding','27800000-0000-4000-8000-000000000001','manual','r2a14')$$,'42501',null,'the tracker definer rejects a deactivated tenant');
select throws_ok($$select public.record_outcome('27800000-0000-4000-8000-000000000402','denied',null,current_date,'27800000-0000-4000-8000-000000000001')$$,'42501',null,'the outcome definer rejects a deactivated tenant');

select throws_ok($$select public.affiliate_share_client('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-000000000201')$$,'42501',null,'the affiliate share RPC cannot write for a deactivated tenant');
select lives_ok($$select public.affiliate_unshare_client('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-000000000201')$$,'the affiliate unshare RPC returns without bypassing the wall');
select is((select count(*)::integer from public.affiliate_client_shares where affiliate_id='27800000-0000-4000-8000-000000000301' and client_id='27800000-0000-4000-8000-000000000201'),1,'the deactivated tenant share remains unchanged');
select lives_ok($$select public.affiliate_update_share('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-000000000201','{"expectedCommissionCents":2000}'::jsonb)$$,'the affiliate update RPC returns without bypassing the wall');
select is((select expected_commission_cents from public.affiliate_client_shares where affiliate_id='27800000-0000-4000-8000-000000000301' and client_id='27800000-0000-4000-8000-000000000201'),1000::bigint,'the deactivated tenant commission remains unchanged');

select throws_ok($$select public.fees_set_agreement('27800000-0000-4000-8000-000000000201','percentage',12,null,null,null,null,'active')$$,'42501',null,'the agreement RPC cannot write for a deactivated tenant');
select throws_ok($$select public.fees_set_org_default('27800000-0000-4000-8000-000000000101','percentage',12,null,null,null,null)$$,'42501',null,'the default RPC cannot write for a deactivated tenant');
select throws_ok($$select public.fees_record_payment('27800000-0000-4000-8000-000000000201',500,current_date,'bank_transfer',null,null)$$,'42501',null,'the payment RPC cannot write for a deactivated tenant');
select lives_ok($$select public.fees_reverse_payment('27800000-0000-4000-8000-000000000701')$$,'the reversal RPC returns without bypassing the wall');
select is((select reversed_at is null from public.fee_payments where id='27800000-0000-4000-8000-000000000701'),true,'the deactivated tenant payment remains unchanged');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000006')::text, true);
select lives_ok($$update public.clients set display_name='Current Allowed' where id='27800000-0000-4000-8000-000000000202'$$,'a current tenant can still write');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000007')::text, true);
select lives_ok($$update public.clients set display_name='Trial Allowed' where id='27800000-0000-4000-8000-000000000203'$$,'a trial tenant can still write');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub','27800000-0000-4000-8000-000000000005')::text, true);
select lives_ok($$update public.outcome_notifications set read_at=now() where id='27800000-0000-4000-8000-000000000602'$$,'a consumer write is unchanged by tenant membership');

select * from finish();
rollback;
