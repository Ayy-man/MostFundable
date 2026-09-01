begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

update public.profiles
set org_role = 'admin'
where id = 'a1000000-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$delete from public.clients where id = 'a3000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'the workspace owner cannot hard-delete a client'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000002"}';
select throws_ok(
  $$delete from public.clients where id = 'a3000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'a workspace administrator cannot hard-delete a client'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select throws_ok(
  $$delete from public.clients where id = 'a3000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'a consumer cannot hard-delete a client'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select throws_ok(
  $$delete from public.clients where id = 'a3000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'an affiliate cannot hard-delete a client'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$delete from public.clients where id = 'a3000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'a platform administrator cannot hard-delete a client'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select public.set_client_status(
  'a3000000-0000-0000-0000-000000000004',
  'archived',
  'a1000000-0000-0000-0000-000000000001'
);
reset role;

select is(
  (select status from public.clients where id = 'a3000000-0000-0000-0000-000000000004'),
  'archived'::public.client_status,
  'the governed status path still archives the client'
);
select is(
  (select count(*)::integer from public.audit_log
   where client_id = 'a3000000-0000-0000-0000-000000000004'
     and action = 'client.status.changed'
     and meta ->> 'to' = 'archived'),
  1,
  'archiving writes exactly one fixed client status audit action'
);

select * from finish();
rollback;
