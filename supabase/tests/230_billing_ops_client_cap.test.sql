begin;
set local search_path = public, extensions;

select plan(36);

select has_column('public', 'orgs', 'client_cap', 'orgs has a client cap');
select col_type_is('public', 'orgs', 'client_cap', 'integer', 'client cap is integer');
select col_is_null('public', 'orgs', 'client_cap', 'client cap is nullable');
select ok(
  (select column_default is null from information_schema.columns where table_schema='public' and table_name='orgs' and column_name='client_cap'),
  'client cap has no default'
);
select has_check('public', 'orgs', 'orgs carries the client cap check');
select has_trigger('public', 'orgs', 'orgs_billing_client_cap_guard', 'direct cap writes are guarded');
select has_trigger('public', 'clients', 'clients_billing_cap_guard', 'client writes enforce the cap');
select has_function('public', 'billing_read_client_cap', array['uuid'], 'cap reader exists');
select has_function('public', 'billing_raise_client_cap', array['uuid','uuid','integer'], 'cap raise RPC exists');
select function_lang_is('public', 'billing_raise_client_cap', array['uuid','uuid','integer'], 'plpgsql', 'raise RPC is plpgsql');
select function_returns('public', 'billing_read_client_cap', array['uuid'], 'setof record', 'cap reader returns a closed record');
select ok(has_function_privilege('authenticated', 'public.billing_read_client_cap(uuid)', 'execute'), 'authenticated can call the scoped reader');
select ok(has_function_privilege('service_role', 'public.billing_read_client_cap(uuid)', 'execute'), 'service role can call the reader');
select ok(not has_function_privilege('anon', 'public.billing_read_client_cap(uuid)', 'execute'), 'anonymous cannot call the reader');
select ok(has_function_privilege('service_role', 'public.billing_raise_client_cap(uuid,uuid,integer)', 'execute'), 'service role reaches the raise RPC');
select ok(not has_function_privilege('authenticated', 'public.billing_raise_client_cap(uuid,uuid,integer)', 'execute'), 'authenticated cannot call the raise RPC directly');

insert into auth.users (id, email) values
  ('18000000-0000-4000-8000-000000000001', 'platform-admin@billing-cap.test'),
  ('18000000-0000-4000-8000-000000000002', 'owner@billing-cap.test'),
  ('18000000-0000-4000-8000-000000000003', 'foreign-owner@billing-cap.test');

insert into public.orgs (id, name, slug) values
  ('18000000-0000-4000-8000-000000000100', 'Cap Org', 'cap-org'),
  ('18000000-0000-4000-8000-000000000101', 'Foreign Cap Org', 'foreign-cap-org');

insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('18000000-0000-4000-8000-000000000001', 'platform_admin', null, null, 'Cap Admin', 'platform-admin@billing-cap.test'),
  ('18000000-0000-4000-8000-000000000002', 'operator_member', '18000000-0000-4000-8000-000000000100', 'owner', 'Cap Owner', 'owner@billing-cap.test'),
  ('18000000-0000-4000-8000-000000000003', 'operator_member', '18000000-0000-4000-8000-000000000101', 'owner', 'Foreign Owner', 'foreign-owner@billing-cap.test')
on conflict (id) do update
set role=excluded.role, org_id=excluded.org_id, org_role=excluded.org_role,
    full_name=excluded.full_name, email=excluded.email;

-- 2026-08-17 R3A-05: the cap fixture needs one pre-existing archived client,
-- so mark only this setup insert as governed.
select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (id, org_id, display_name, status, archived_at, archived_by) values
  ('18000000-0000-4000-8000-000000000201', '18000000-0000-4000-8000-000000000100', 'Active One', 'active', null, null),
  ('18000000-0000-4000-8000-000000000202', '18000000-0000-4000-8000-000000000100', 'Archived One', 'archived', now(), '18000000-0000-4000-8000-000000000002'),
  ('18000000-0000-4000-8000-000000000203', '18000000-0000-4000-8000-000000000101', 'Foreign Active', 'active', null, null);
select pg_catalog.set_config('app.governed_client_write', '', true);

select results_eq(
  $$select active_count, client_cap from public.billing_read_client_cap('18000000-0000-4000-8000-000000000100')$$,
  $$values (1, null::integer)$$,
  'null cap reads active-only count'
);
select lives_ok(
  $$insert into public.clients (id, org_id, display_name) values ('18000000-0000-4000-8000-000000000204','18000000-0000-4000-8000-000000000100','Uncapped Two')$$,
  'null cap permits another active client'
);
select throws_ok(
  $$update public.orgs set client_cap = -1 where id = '18000000-0000-4000-8000-000000000100'$$,
  '42501', 'CLIENT_CAP_WRITE_FORBIDDEN', 'direct negative writes are blocked before the check'
);
select throws_ok(
  $$update public.orgs set client_cap = 0 where id = '18000000-0000-4000-8000-000000000100'$$,
  '42501', 'CLIENT_CAP_WRITE_FORBIDDEN', 'direct valid writes are also blocked'
);
select throws_ok(
  $$select public.billing_raise_client_cap('18000000-0000-4000-8000-000000000100','18000000-0000-4000-8000-000000000002',2)$$,
  '42501', 'CLIENT_CAP_PLATFORM_ADMIN_REQUIRED', 'operator owner cannot raise a cap'
);
select lives_ok(
  $$select public.billing_raise_client_cap('18000000-0000-4000-8000-000000000100','18000000-0000-4000-8000-000000000001',2)$$,
  'platform admin can set the first finite cap'
);
select is((select client_cap from public.orgs where id='18000000-0000-4000-8000-000000000100'), 2, 'first finite cap persists');
select is((select count(*)::integer from public.audit_log where action='billing.client_cap_raised' and org_id='18000000-0000-4000-8000-000000000100'), 1, 'one real raise writes one audit');
select throws_ok(
  $$select public.billing_raise_client_cap('18000000-0000-4000-8000-000000000100','18000000-0000-4000-8000-000000000001',2)$$,
  '22023', 'CLIENT_CAP_MUST_INCREASE', 'equal cap is rejected'
);
select throws_ok(
  $$select public.billing_raise_client_cap('18000000-0000-4000-8000-000000000100','18000000-0000-4000-8000-000000000001',1)$$,
  '22023', 'CLIENT_CAP_MUST_INCREASE', 'lower cap is rejected'
);
select throws_ok(
  $$insert into public.clients (id, org_id, display_name) values ('18000000-0000-4000-8000-000000000205','18000000-0000-4000-8000-000000000100','Over Cap')$$,
  'P0001', 'CLIENT_CAP_REACHED', 'active insert at cap is refused'
);
-- 2026-08-17 R1A-03 carries lifecycle changes through the governed status RPC.
set local request.jwt.claims = '{"sub":"18000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select * from public.set_client_status('18000000-0000-4000-8000-000000000204','archived','18000000-0000-4000-8000-000000000002')$$,
  'active to archived releases a slot'
);
reset role;
select lives_ok(
  $$insert into public.clients (id, org_id, display_name) values ('18000000-0000-4000-8000-000000000205','18000000-0000-4000-8000-000000000100','Replacement Active')$$,
  'released slot accepts one active client'
);
set local role authenticated;
select throws_ok(
  $$select * from public.set_client_status('18000000-0000-4000-8000-000000000202','active','18000000-0000-4000-8000-000000000002')$$,
  'P0001', 'CLIENT_CAP_REACHED', 'archived to active consumes a slot and is refused at cap'
);
reset role;
select is((select count(*)::integer from public.audit_log where action='billing.client_cap_raised' and org_id='18000000-0000-4000-8000-000000000100'), 1, 'denials and replays add no audit');
select lives_ok(
  $$select public.billing_raise_client_cap('18000000-0000-4000-8000-000000000100','18000000-0000-4000-8000-000000000001',3)$$,
  'platform admin can raise a finite cap'
);
select is((select count(*)::integer from public.audit_log where action='billing.client_cap_raised' and org_id='18000000-0000-4000-8000-000000000100'), 2, 'second real raise writes one more audit');

set local request.jwt.claims = '{"sub":"18000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local role authenticated;
select results_eq(
  $$select active_count, client_cap from public.billing_read_client_cap('18000000-0000-4000-8000-000000000100')$$,
  $$values (2, 3)$$,
  'operator reads its own active count and cap'
);
select throws_ok(
  $$select * from public.billing_read_client_cap('18000000-0000-4000-8000-000000000101')$$,
  '42501', 'CLIENT_CAP_READ_FORBIDDEN', 'operator cannot read another org cap'
);
reset role;

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('private.billing_enforce_client_cap()'::regprocedure),
    'pg_advisory_xact_lock'
  ) > 0,
  'cap enforcement contains the transaction-scoped serialization primitive'
);

select * from finish();
rollback;
