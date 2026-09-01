begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

update public.profiles set org_role = 'admin'
where id = 'a1000000-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select throws_ok(
  $$select * from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a consumer cannot read the workspace client cap aggregate'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select throws_ok(
  $$select * from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'an affiliate cannot read the workspace client cap aggregate'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$select * from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a foreign workspace operator cannot read the client cap aggregate'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select isnt_empty(
  $$select active_count, client_cap from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  'the workspace owner can read its active count and cap'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000002"}';
select isnt_empty(
  $$select active_count, client_cap from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  'an active workspace administrator can read its active count and cap'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select isnt_empty(
  $$select active_count, client_cap from public.billing_read_client_cap('a0000000-0000-0000-0000-000000000001')$$,
  'an active platform administrator can read the active count and cap'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select public.billing_raise_client_cap(
      'a0000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001', 999
    )$$,
  'the independent client-cap raise operation remains available'
);
reset role;

select * from finish();
rollback;
