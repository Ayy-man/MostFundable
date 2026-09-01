begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r4a02-affiliate-insert', 'r4a02-consumer-insert', 'r4a02-cross-tenant-insert', 'r4a02-operator-insert', 'r4a02-owner-seed', 'r4a02-platform-insert', 'r4a02-service-insert', 'r4a02-specialist-insert']) as handle
on conflict (bank_ref) do nothing;

-- R4A-02. Migration 080 scoped the application write policies through
-- `private.can_access_client` and the tenant wall alone, and `can_access_client`
-- is true for a consumer's own client, so a consumer's own JWT reached the
-- operator tracker through the Data API. Every negative below stored its value
-- on `c2df7ae`; every positive below must keep working.

-- The operator tracker row on Casey's client, seeded as the table owner.
insert into public.applications(id, client_id, bank_ref, created_by)
values (
  '35100000-0000-4000-8000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'r4a02-owner-seed',
  'a1000000-0000-0000-0000-000000000001'
);

-- ---------------------------------------------------------------------------
-- The consumer arm: reachable client, wrong caller kind.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';

select throws_ok(
  $$
    insert into public.applications(
      id, client_id, bank_ref, operator_status, consumer_status,
      amount_cents, visibility, created_by
    ) values (
      '35100000-0000-4000-8000-000000000002',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-consumer-insert',
      'todo', 'approved', 999999999, 'status_only',
      'a1000000-0000-0000-0000-000000000011'
    )
  $$,
  '42501',
  null,
  'a consumer JWT cannot insert an application on its own client'
);

select is_empty(
  $$update public.applications set operator_status = 'todo'
    where id = '35100000-0000-4000-8000-000000000001' returning id$$,
  'a consumer JWT cannot set operator_status'
);
select is_empty(
  $$update public.applications set consumer_status = 'approved'
    where id = '35100000-0000-4000-8000-000000000001' returning id$$,
  'a consumer JWT cannot set consumer_status'
);
select is_empty(
  $$update public.applications set amount_cents = 999999999
    where id = '35100000-0000-4000-8000-000000000001' returning id$$,
  'a consumer JWT cannot set amount_cents'
);
select is_empty(
  $$update public.applications set visibility = 'status_only'
    where id = '35100000-0000-4000-8000-000000000001' returning id$$,
  'a consumer JWT cannot set visibility'
);

-- The consumer read path and the consumer note path are deliberately untouched.
select results_eq(
  $$select count(*)::integer from public.applications
    where client_id = 'a3000000-0000-0000-0000-000000000001'$$,
  $$values (1)$$,
  'a consumer still reads the applications on its own client'
);
select lives_ok(
  $$insert into public.application_notes(application_id, author_profile_id, author_kind, body)
    values (
      '35100000-0000-4000-8000-000000000001',
      'a1000000-0000-0000-0000-000000000011',
      'consumer',
      'The consumer note path stays reachable.'
    )$$,
  'a consumer still adds a note to an application on its own client'
);

-- ---------------------------------------------------------------------------
-- The affiliate arm: unchanged, and asserted so the caller-kind list is closed.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select throws_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000003',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-affiliate-insert',
      'a1000000-0000-0000-0000-000000000003'
    )
  $$,
  '42501',
  null,
  'an affiliate JWT cannot insert an application'
);

-- ---------------------------------------------------------------------------
-- The operator and platform-admin arms: the writers the routes actually use.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select lives_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000004',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-operator-insert',
      'a1000000-0000-0000-0000-000000000001'
    )
  $$,
  'the operator owner still inserts an application through the authenticated path'
);
select lives_ok(
  $$update public.applications
      set operator_status = 'todo', consumer_status = 'approved',
          amount_cents = 4200, visibility = 'details'
    where id = '35100000-0000-4000-8000-000000000004'$$,
  'the operator owner still patches all four mutable columns'
);
select results_eq(
  $$select operator_status::text collate "C", consumer_status::text collate "C",
           amount_cents, visibility::text collate "C"
    from public.applications where id = '35100000-0000-4000-8000-000000000004'$$,
  $$values ('todo'::text collate "C", 'approved'::text collate "C", 4200::bigint, 'details'::text collate "C")$$,
  'the operator patch stored every mutable column'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000002"}';
select lives_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000005',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-specialist-insert',
      'a1000000-0000-0000-0000-000000000002'
    )
  $$,
  'an assigned operator member still inserts an application'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select lives_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000006',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-platform-insert',
      '00000000-0000-0000-0000-000000000001'
    )
  $$,
  'the platform administrator still inserts an application'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"b1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000007',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-cross-tenant-insert',
      'b1000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  null,
  'an operator from another tenant still cannot insert an application'
);

-- ---------------------------------------------------------------------------
-- The flag-OFF arm: with FEATURE_REAL_AUTH off the repository writes through the
-- admin client, so `service_role` must remain able to write.
-- ---------------------------------------------------------------------------

set local role service_role;
select lives_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values (
      '35100000-0000-4000-8000-000000000008',
      'a3000000-0000-0000-0000-000000000001',
      'r4a02-service-insert',
      'a1000000-0000-0000-0000-000000000001'
    )
  $$,
  'the flag-off admin-client writer still inserts an application'
);
select lives_ok(
  $$update public.applications set operator_status = 'todo', amount_cents = 7
    where id = '35100000-0000-4000-8000-000000000008'$$,
  'the flag-off admin-client writer still patches an application'
);

reset role;

-- ---------------------------------------------------------------------------
-- Policy shape: the predicate is on both write policies and on neither of the
-- two paths that must stay consumer-reachable.
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy as policy
    where policy.polrelid = 'public.applications'::regclass
      and policy.polname in ('applications_insert_scoped', 'applications_update_scoped')
      and pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) like '%session_actor_kind%'
  ),
  2,
  'both application write policies carry the caller-kind predicate'
);

select ok(
  (
    select pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) not like '%session_actor_kind%'
    from pg_catalog.pg_policy as policy
    where policy.polrelid = 'public.applications'::regclass
      and policy.polname = 'applications_select_scoped'
  )
  and (
    select pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) not like '%session_actor_kind%'
    from pg_catalog.pg_policy as policy
    where policy.polrelid = 'public.application_notes'::regclass
      and policy.polname = 'application_notes_insert_scoped'
  ),
  'the consumer read policy and the consumer note policy are untouched'
);

select * from finish();
rollback;
