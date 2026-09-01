begin;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('39800000-0000-4000-8000-000000000111', 'assignment.operator@one.example'),
  ('39800000-0000-4000-8000-000000000112', 'assignment.consumer@one.example'),
  ('39800000-0000-4000-8000-000000000113', 'assignment.second@one.example'),
  ('39800000-0000-4000-8000-000000000121', 'assignment.operator@two.example');
insert into public.orgs (id, name, slug, team_sees_all_clients) values
  ('39800000-0000-4000-8000-000000000001', 'Assignment One', 'assignment-one', true),
  ('39800000-0000-4000-8000-000000000002', 'Assignment Two', 'assignment-two', true);
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('39800000-0000-4000-8000-000000000111', 'operator_member', '39800000-0000-4000-8000-000000000001', 'owner', 'Assignment Operator One', 'assignment.operator@one.example'),
  ('39800000-0000-4000-8000-000000000112', 'consumer', '39800000-0000-4000-8000-000000000001', null, 'Assignment Consumer One', 'assignment.consumer@one.example'),
  ('39800000-0000-4000-8000-000000000113', 'operator_member', '39800000-0000-4000-8000-000000000001', 'admin', 'Assignment Operator Two', 'assignment.second@one.example'),
  ('39800000-0000-4000-8000-000000000121', 'operator_member', '39800000-0000-4000-8000-000000000002', 'owner', 'Assignment Other Org', 'assignment.operator@two.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to) values (
  '39800000-0000-4000-8000-000000000101',
  '39800000-0000-4000-8000-000000000001',
  '39800000-0000-4000-8000-000000000112',
  'Assignment Client One',
  '39800000-0000-4000-8000-000000000111'
);

select has_table('public', 'client_assignment_history', 'assignment history exists');
select is((select count(*)::integer from client_assignment_history where client_id = '39800000-0000-4000-8000-000000000101'), 0, 'the migration backfills no assignment');
select set_config('app.governed_client_write', 'on', true);
update clients set assigned_to = '39800000-0000-4000-8000-000000000113' where id = '39800000-0000-4000-8000-000000000101';
select is((select count(*)::integer from client_assignment_history where client_id = '39800000-0000-4000-8000-000000000101'), 1, 'one assignment change writes one history row');
update clients set assigned_to = '39800000-0000-4000-8000-000000000113' where id = '39800000-0000-4000-8000-000000000101';
select is((select count(*)::integer from client_assignment_history where client_id = '39800000-0000-4000-8000-000000000101'), 1, 'writing the same assignee does not duplicate history');
select is((select count(*)::integer from audit_log where action = 'client.assignment_changed' and client_id = '39800000-0000-4000-8000-000000000101'), 1, 'one assignment change writes one audit row');
select is((select array_agg(key order by key) from audit_log, lateral jsonb_object_keys(meta) as key where action = 'client.assignment_changed' and client_id = '39800000-0000-4000-8000-000000000101'), array['from_state', 'to_state'], 'assignment audit metadata uses the two state keys');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39800000-0000-4000-8000-000000000112"}';
select is((select count(*)::integer from client_assignment_history), 0, 'the consumer cannot read assignments');
select throws_ok($$ insert into client_assignment_history (org_id, client_id, from_user, to_user) values ('39800000-0000-4000-8000-000000000001', '39800000-0000-4000-8000-000000000101', '39800000-0000-4000-8000-000000000111', '39800000-0000-4000-8000-000000000113') $$, '42501', 'permission denied for table client_assignment_history', 'the consumer cannot write assignment history');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39800000-0000-4000-8000-000000000111"}';
select is((select count(*)::integer from client_assignment_history), 1, 'the own-organization operator reads assignment history');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39800000-0000-4000-8000-000000000121"}';
select is((select count(*)::integer from client_assignment_history), 0, 'another organization operator reads no assignment history');

reset role;
set local role anon;
select throws_ok($$ select * from client_assignment_history $$, '42501', 'permission denied for table client_assignment_history', 'anonymous cannot read assignment history');

reset role;
set local role service_role;
select is((select count(*)::integer from client_assignment_history where client_id = '39800000-0000-4000-8000-000000000101'), 1, 'service maintenance can read assignment history');

reset role;
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.client_assignment_history'::regclass), true, 'assignment RLS is enabled and forced');

select * from finish();
rollback;
