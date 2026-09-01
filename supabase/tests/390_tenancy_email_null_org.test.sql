-- 390_tenancy_email_null_org.test.sql
--
-- The cross-tenant email guard, over the org-shape cases the schema actually permits.
--
-- Watched failing against the pre-fix function, where the predicate was
-- `profile.org_id is distinct from actor.org_id`: assertion 1 reported `have: false / want: true`
-- and nothing else went red — 1 of 7. That single case is the bypass, and it is the one the old
-- comparison got backwards, because `is distinct from` reads two NULLs as the same tenant.
--
-- **Each scenario gets its own address, and that is load-bearing rather than tidy.** The first
-- version of this file gave all three fixtures one shared address, so the org-bound row satisfied
-- `exists` on its own and assertion 1 passed against the pre-fix function — a green that proved
-- nothing. `exists` is a disjunction over every matching row, so a fixture that shares an address
-- with the case under test can only mask it, never expose it.
--
-- Assertions 5-7 derive rather than transcribe. Which roles may hold a null `org_id` is a fact owned
-- by `profiles_role_shape_check`, not by this file, so they read the constraint back out of the
-- catalog and assert the property the fix's reachability argument rests on. If a later migration
-- makes `org_id` mandatory for consumers, assertion 6 fails and says so, rather than letting this
-- file quietly go on testing a case that can no longer occur.

begin;

set local search_path = public, extensions;

select plan(7);


-- ---------------------------------------------------------------------------
-- Fixtures. Profiles are created by the `auth.users` bootstrap trigger, so these insert into auth
-- and then shape the row, which is the path a real signup takes.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
select
  ('c0000000-0000-0000-0000-0000000000' || suffix)::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'tap-auth-' || suffix || '@example.test', 'x', now(), now()
from (values ('a1'),('a2'),('a3'),('a4'),('a5'),('a6'),('a7')) as ids(suffix);

-- Scenario 1 — the bypass: two org-less accounts on one address.
update public.profiles set email = 'tap-null@example.test', role = 'consumer', org_id = null, org_role = null
  where id = 'c0000000-0000-0000-0000-0000000000a1';
update public.profiles set email = 'tap-null@example.test', role = 'platform_admin', org_id = null, org_role = null
  where id = 'c0000000-0000-0000-0000-0000000000a2';

-- Scenario 2 — one side org-less.
update public.profiles set email = 'tap-mixed@example.test', role = 'consumer', org_role = null,
       org_id = (select id from public.orgs order by created_at limit 1)
  where id = 'c0000000-0000-0000-0000-0000000000a3';
update public.profiles set email = 'tap-mixed@example.test', role = 'platform_admin', org_id = null, org_role = null
  where id = 'c0000000-0000-0000-0000-0000000000a4';

-- Scenario 3 — an org-less account nobody shares an address with.
update public.profiles set email = 'tap-alone@example.test', role = 'consumer', org_id = null, org_role = null
  where id = 'c0000000-0000-0000-0000-0000000000a5';

-- Scenario 4 — two accounts in the SAME org on one address.
update public.profiles set email = 'tap-sameorg@example.test', role = 'consumer', org_role = null,
       org_id = (select id from public.orgs order by created_at limit 1)
  where id in ('c0000000-0000-0000-0000-0000000000a6','c0000000-0000-0000-0000-0000000000a7');


-- ---------------------------------------------------------------------------
-- 1. The bypass. This is the assertion that was false before the fix.
-- ---------------------------------------------------------------------------

select is(
  public.tenancy_email_registered_elsewhere('tap-null@example.test','c0000000-0000-0000-0000-0000000000a1'),
  true,
  'an org-less actor whose address exists on another org-less account is registered elsewhere: two absent orgs are two absences, not one tenant'
);


-- ---------------------------------------------------------------------------
-- 2-4. The paths that must not move. Shipping this depends on these staying put.
-- ---------------------------------------------------------------------------

select is(
  public.tenancy_email_registered_elsewhere('tap-mixed@example.test','c0000000-0000-0000-0000-0000000000a3'),
  true,
  'an org-bound actor sharing an address with an org-less account is registered elsewhere'
);

select is(
  public.tenancy_email_registered_elsewhere('tap-sameorg@example.test','c0000000-0000-0000-0000-0000000000a6'),
  false,
  'two accounts in the same org are one tenant, so a shared address there is not registered elsewhere'
);

select is(
  public.tenancy_email_registered_elsewhere('tap-alone@example.test','c0000000-0000-0000-0000-0000000000a5'),
  false,
  'a lone org-less signup whose address matches no other profile still enrolls'
);


-- ---------------------------------------------------------------------------
-- 5-7. Reachability, derived from the catalog that owns it.
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public' and tablename = 'profiles'
      and indexdef ilike '%unique%' and indexdef ilike '%(email)%'
  ),
  0,
  'profiles.email carries no unique index, so two profiles sharing an address is representable'
);

select ok(
  (
    select pg_get_constraintdef(oid) not ilike '%consumer%org_id IS NOT NULL%'
    from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_shape_check'
  ),
  'profiles_role_shape_check does not force an org on a consumer, so an org-less consumer is reachable'
);

select ok(
  (
    select pg_get_constraintdef(oid) ilike '%platform_admin%org_id IS NULL%'
    from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_shape_check'
  ),
  'every platform_admin is forced org-less, so an org-less counterpart always exists to collide with'
);


select * from finish();

rollback;
