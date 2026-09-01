begin;
select plan(4);

-- The subjects are DERIVED from the seed at test time, never transcribed:
-- the defect this guards was a constraint written against RFC-4122 while the
-- seed's ids are version-0, and a transcribed RFC-conformant fixture id is
-- exactly how the original suite missed it.

select lives_ok(
  format(
    $$select * from public.admin_upsert_kpi_rollup('member', %L, '2026-08-18')$$,
    'member:' || (select id from public.profiles where role = 'operator_member' order by id limit 1)
  ),
  'kpi rollup accepts a member subject built from a seeded profile id'
);

select lives_ok(
  format(
    $$select * from public.admin_upsert_kpi_rollup('org', %L, '2026-08-18')$$,
    'org:' || (select id from public.orgs order by id limit 1)
  ),
  'kpi rollup accepts an org subject built from a seeded org id'
);

select throws_ok(
  $$insert into public.kpi_rollups(scope,subject_id,day,metrics)
    values ('member','member:not-a-uuid','2026-08-18','{}'::jsonb)$$,
  '23514',
  null,
  'a non-uuid member subject still violates the shape constraint'
);

select throws_ok(
  $$insert into public.kpi_rollups(scope,subject_id,day,metrics)
    values ('platform','org:23100000-0000-4000-8000-000000000010','2026-08-18','{}'::jsonb)$$,
  '23514',
  null,
  'a platform-scope row still cannot carry an org subject'
);

select * from finish();
rollback;
