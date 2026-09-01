begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

update public.profiles set org_role = 'admin'
where id = 'a1000000-0000-0000-0000-000000000002';
insert into public.org_fee_defaults(org_id, model, pct, updated_by)
values('a0000000-0000-0000-0000-000000000001', 'percentage', 12.5, 'a1000000-0000-0000-0000-000000000001');
insert into public.org_flags(org_id)
values('a0000000-0000-0000-0000-000000000001')
on conflict (org_id) do nothing;
insert into public.fee_agreements(client_id, org_id, model, pct, status, source)
values('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'percentage', 10, 'active', 'operator_override');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (0::bigint, 0::bigint)$$,
  'a same-workspace consumer reads no default or legal-evidence row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (0::bigint, 0::bigint)$$,
  'a same-workspace affiliate reads no default or legal-evidence row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"b1000000-0000-0000-0000-000000000001"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (0::bigint, 0::bigint)$$,
  'a foreign-workspace operator reads no default or legal-evidence row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (1::bigint, 1::bigint)$$,
  'the workspace owner reads its default and legal-evidence row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000002"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (1::bigint, 1::bigint)$$,
  'an active workspace administrator reads both governance rows'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select results_eq(
  $$select
      (select count(*) from public.org_fee_defaults),
      (select count(*) from public.org_flags)$$,
  $$values (1::bigint, 1::bigint)$$,
  'an active platform administrator reads both governance rows'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select is(
  public.fees_read_client_fees('a3000000-0000-0000-0000-000000000001') -> 'agreement' ->> 'model',
  'percentage',
  'a consumer still reads agreement facts for the consumer own client'
);
reset role;

select * from finish();
rollback;
