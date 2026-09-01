begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ---------------------------------------------------------------------------
-- The constraint itself, read off the catalog rather than off the migration:
-- the interesting property is not "an ALTER ran" but "the key is present,
-- validated, and pointed where INTERFACES §3 says".
-- ---------------------------------------------------------------------------

select is(
  (
    select constraint_definition.contype::text
    from pg_constraint as constraint_definition
    where constraint_definition.conname = 'applications_bank_ref_fk'
  ),
  'f',
  'applications.bank_ref carries a foreign key'
);

select is(
  (
    select referenced.relname::text
    from pg_constraint as constraint_definition
    join pg_class as referenced on referenced.oid = constraint_definition.confrelid
    where constraint_definition.conname = 'applications_bank_ref_fk'
  ),
  'banks_cache',
  'and it points at the synced lender catalog'
);

select is(
  (
    select constraint_definition.convalidated
    from pg_constraint as constraint_definition
    where constraint_definition.conname = 'applications_bank_ref_fk'
  ),
  true,
  'the key is validated, not left NOT VALID with the old rows unchecked'
);

-- RESTRICT both ways. On delete because a lender leaving the catalog must never
-- take a client's application history with it; on update because migration
-- 317's identity guard is ENABLE ALWAYS and raises on any change to bank_ref,
-- so a cascade would be rejected by that trigger the instant it fired.
select is(
  (
    select constraint_definition.confdeltype::text || constraint_definition.confupdtype::text
    from pg_constraint as constraint_definition
    where constraint_definition.conname = 'applications_bank_ref_fk'
  ),
  'rr',
  'RESTRICT on delete and on update'
);

-- ---------------------------------------------------------------------------
-- Behaviour.
-- ---------------------------------------------------------------------------

insert into public.clients(id, org_id, display_name)
values('38300000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'FK proof client');

insert into public.banks_cache(bank_ref, name, application_questions)
values(
  'fk383-known', 'FK383 Known',
  '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},
    {"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'
);

select lives_ok(
  $$insert into public.applications(id, client_id, bank_ref, created_by)
    values('38300000-0000-4000-8000-000000000002', '38300000-0000-4000-8000-000000000001',
           'fk383-known', 'a1000000-0000-0000-0000-000000000001')$$,
  'an application may name a lender that is in the catalog'
);

select throws_ok(
  $$insert into public.applications(id, client_id, bank_ref, created_by)
    values('38300000-0000-4000-8000-000000000003', '38300000-0000-4000-8000-000000000001',
           'fk383-unknown', 'a1000000-0000-0000-0000-000000000001')$$,
  '23503', null,
  'and may not name one that is not — which is the whole point of the key'
);

select throws_ok(
  $$delete from public.banks_cache where bank_ref = 'fk383-known'$$,
  '23503', null,
  'a lender with applications behind it cannot be deleted out from under them'
);

-- The unpublish that stands in for a delete. This is the property the sync
-- job's upsert-never-delete rule buys: a lender can leave every surface without
-- the key ever seeing an orphan.
update public.banks_cache set is_active = false where bank_ref = 'fk383-known';
select is(
  (
    select count(*)::integer
    from public.applications
    where bank_ref = 'fk383-known'
  ),
  1,
  'unpublishing the lender leaves its applications intact'
);
select is(
  (select count(*)::integer from public.bank_read_model where bank_ref = 'fk383-known'),
  0,
  'while removing it from everything the API serves'
);

select * from finish();
rollback;
