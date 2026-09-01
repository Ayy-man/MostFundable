begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

grant execute on function private.require_governed_write(text) to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select pg_catalog.set_config('app.r3a00_probe', 'on', true);
select throws_ok(
  $$select private.require_governed_write('r3a00_probe')$$,
  '42501', null,
  'a marker cannot authorize a non-owner caller'
);
reset role;
revoke execute on function private.require_governed_write(text) from authenticated;

select is(
  private.session_actor_kind('a1000000-0000-0000-0000-000000000001'),
  'operator',
  'the seeded owner resolves to the operator actor kind'
);
select is(
  private.session_actor_kind('a1000000-0000-0000-0000-000000000011'),
  'consumer',
  'Casey resolves to the consumer actor kind'
);

update public.profiles
set disabled_at = pg_catalog.clock_timestamp()
where id = 'a1000000-0000-0000-0000-000000000003';
select is(
  private.session_actor_kind('a1000000-0000-0000-0000-000000000003'),
  null::text,
  'a disabled profile has no session actor kind'
);

select * from finish();
rollback;
