begin;

set local search_path = public, extensions;

select plan(7);

select is(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'tenancy_guard_org_slug'
  ),
  true,
  'the slug guard still runs as its owner after the replacement'
);

-- Exactly one platform-intake org may exist (orgs_one_platform_intake_idx), so the test
-- works against the seeded one and only creates a fixture when the seed is absent.
insert into public.orgs (id, name, slug, brand)
select
  '23100000-0000-4000-8000-000000000001',
  'Self Upsert Intake Fixture',
  'self-upsert-intake-fixture',
  '{"fictional": true, "platform_intake": true}'::jsonb
where not exists (
  select 1 from public.orgs where brand @> '{"platform_intake": true}'::jsonb
);

select lives_ok(
  $$
    insert into public.orgs (id, name, slug, brand)
    select organization.id, organization.name, organization.slug, organization.brand
    from public.orgs as organization
    where organization.brand @> '{"platform_intake": true}'::jsonb
    limit 1
    on conflict (id) do update
    set name = excluded.name, slug = excluded.slug, brand = excluded.brand
  $$,
  'the platform-intake org keeps its own slug through the seed-shaped on-conflict upsert'
);
select is(
  (select count(*)::int from public.orgs where brand @> '{"platform_intake": true}'::jsonb),
  1,
  'the upsert converged the existing row rather than adding one'
);
select throws_ok(
  $$
    insert into public.orgs (name, slug)
    select 'Squatter', organization.slug
    from public.orgs as organization
    where organization.brand @> '{"platform_intake": true}'::jsonb
    limit 1
  $$,
  '23514', 'TENANT_SLUG_RESERVED', 'another org still cannot take the platform-intake slug'
);
select throws_ok(
  $$
    insert into public.orgs (id, name, slug)
    select '23100000-0000-4000-8000-000000000002', 'Squatter Upsert', organization.slug
    from public.orgs as organization
    where organization.brand @> '{"platform_intake": true}'::jsonb
    limit 1
    on conflict (id) do update set slug = excluded.slug
  $$,
  '23514', 'TENANT_SLUG_RESERVED', 'a different-id upsert cannot take the platform-intake slug either'
);
select throws_ok(
  $$insert into public.orgs (name, slug) values ('Reserved Word', 'admin')$$,
  '23514', 'TENANT_SLUG_RESERVED', 'the static reserved set still fails'
);
select is(
  (
    select private.tenancy_slug_reserved(organization.slug)
    from public.orgs as organization
    where organization.brand @> '{"platform_intake": true}'::jsonb
    limit 1
  ),
  true,
  'the one-argument form still reports the platform-intake slug as reserved'
);

select * from finish();
rollback;
