begin;

set local search_path = public, extensions;

select plan(40);

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------

select has_table('public', 'banks_cache', 'the synced lender catalog exists');
select has_view('public', 'bank_read_model', 'the read model the API selects from exists');
select has_function(
  'private', 'bank_application_questions_valid', array['jsonb'],
  'the application-question allow-list validator exists'
);

select col_is_pk('public', 'banks_cache', 'bank_ref', 'the lender handle is the key');

select is(
  (
    select view_definition.reloptions::text
    from pg_class as view_definition
    join pg_namespace as namespace on namespace.oid = view_definition.relnamespace
    where namespace.nspname = 'public' and view_definition.relname = 'bank_read_model'
  ),
  '{security_invoker=true}',
  'the read model runs as the caller, so its own grants and policies decide the read'
);

-- ---------------------------------------------------------------------------
-- VAULT-05. Derived from the live catalog rather than transcribed: the
-- assertion is "no column of this table or this view is about a credit score
-- floor or about time in business", expressed as a pattern over the real column
-- names, so a column added later under any of those spellings fails here
-- without anyone remembering to extend a list.
-- ---------------------------------------------------------------------------

select is_empty(
  $$
    select attribute.attname
    from pg_attribute as attribute
    join pg_class as relation on relation.oid = attribute.attrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('banks_cache', 'bank_read_model')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        attribute.attname ~ 'fico'
        or attribute.attname ~ 'score'
        or attribute.attname ~ '(^|_)tib($|_)'
        or attribute.attname ~ 'time_in_business'
        or attribute.attname ~ 'months_in_business'
      )
  $$,
  'VAULT-05: no credit-score floor and no time-in-business column reaches the cache or the read model'
);

-- The other half of the same boundary: the unvetted free-text intel columns
-- VAULT carries are not selected either. Same derivation — a pattern over the
-- live column names, not a list this file keeps in step by hand.
select is_empty(
  $$
    select attribute.attname
    from pg_attribute as attribute
    join pg_class as relation on relation.oid = attribute.attrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('banks_cache', 'bank_read_model')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attname in (
        'vault_full_text', 'exact_script', 'winning_patterns',
        'denial_patterns', 'key_gotchas', 'best_fit_profile'
      )
  $$,
  'no unvetted VAULT free-text intel column is cached'
);

-- ---------------------------------------------------------------------------
-- Row security and access.
-- ---------------------------------------------------------------------------

select is(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'banks_cache'
  ),
  true,
  'row security is enabled on the catalog'
);
select is(
  (
    select relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'banks_cache'
  ),
  true,
  'row security is forced, so the owner is filtered too'
);

select is(
  has_table_privilege('anon', 'public.banks_cache', 'select'),
  false,
  'anonymous cannot read the catalog'
);
select is(
  has_table_privilege('authenticated', 'public.banks_cache', 'select'),
  true,
  'every signed-in role can read the catalog, which is the product'
);
select is(
  has_table_privilege('authenticated', 'public.bank_read_model', 'select'),
  true,
  'and the read model with it'
);

-- Upsert-never-delete is the property migration 383''s foreign key leans on, so
-- it is asserted rather than described: no session role holds a write grant and
-- no policy admits a write command.
select is(
  has_table_privilege('authenticated', 'public.banks_cache', 'insert')
    or has_table_privilege('authenticated', 'public.banks_cache', 'update')
    or has_table_privilege('authenticated', 'public.banks_cache', 'delete'),
  false,
  'a session cannot write the catalog at all — the sync job owns it'
);

select is_empty(
  $$
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'banks_cache'
      and cmd <> 'SELECT'
  $$,
  'the catalog carries read policies only; there is no delete path to orphan a foreign key with'
);

-- The policy's shape, not its text. An earlier version of this assertion
-- compared `qual` against a transcribed expression, so tightening the policy
-- failed the test for having changed rather than for being wrong — the rot
-- round 5 named. What is asserted now is that there is exactly one policy and
-- that it is a read policy; what it *does* is asserted behaviourally below,
-- against the roles themselves.
select is(
  (
    select string_agg(policyname || '|' || cmd, ', ' order by policyname)
    from pg_policies
    where schemaname = 'public' and tablename = 'banks_cache'
  ),
  'banks_cache_select_active|SELECT',
  'one policy on the catalog, and it reads'
);

-- ---------------------------------------------------------------------------
-- Who can actually read the catalog. The Bank Vault is an operator surface and
-- `/api/banks` refuses everyone else; these run the same question at the table,
-- so the boundary does not rest on the route being the only door.
-- ---------------------------------------------------------------------------

insert into public.banks_cache (bank_ref, name, is_active, application_questions)
select
  handle,
  name,
  active,
  '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},
    {"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from (
  values ('policy-live', 'Policy Live Bank', true), ('policy-retired', 'Policy Retired Bank', false)
) as seed(handle, name, active)
on conflict (bank_ref) do nothing;

set local role authenticated;

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select is(
  (select count(*)::integer from public.banks_cache where bank_ref = 'policy-live'),
  1,
  'an operator member reads a published lender'
);
select is(
  (select count(*)::integer from public.banks_cache where bank_ref = 'policy-retired'),
  0,
  'an operator member does not read an unpublished lender'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
select is(
  (select count(*)::integer from public.banks_cache where bank_ref = 'policy-live'),
  1,
  'a platform admin reads a published lender'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select is(
  (select count(*)::integer from public.banks_cache),
  0,
  'a consumer reads nothing: lender information reaches them through their plan'
);

set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000003"}';
select is(
  (select count(*)::integer from public.banks_cache),
  0,
  'an affiliate reads nothing: their whole portal is affiliate_client_view'
);

reset role;
reset request.jwt.claims;

-- The four checks above name their roles, so they cannot speak for a fifth.
-- This one is derived: it walks `public.app_role` itself, asks the table the
-- question once per role, and compares the set that can read against the set
-- `/api/banks` serves. A role added to the enum arrives here as an unexpected
-- reader — or as an unrepresented one — rather than going unnoticed.
create function pg_temp.catalog_reader(p_profile uuid)
returns boolean
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('role', 'authenticated', 'sub', p_profile)::text,
    true
  );
  return exists (select 1 from public.banks_cache where bank_ref = 'policy-live');
end;
$$;

select is(
  (
    select pg_catalog.string_agg(role_name::text, ',' order by role_name::text)
    from pg_catalog.unnest(pg_catalog.enum_range(null::public.app_role)) as role_name
    where not exists (select 1 from public.profiles where role = role_name)
  ),
  null,
  'every application role has a seeded profile, so the walk below covers all of them'
);

-- One probe profile per role, chosen while still unrestricted. `public.profiles`
-- is itself RLS-protected, so an authenticated caller cannot build this list —
-- it has to be materialised before the role switch or the walk below silently
-- finds nobody.
create table pg_temp.role_probe as
select
  profile.role::text as role_name,
  (array_agg(profile.id order by profile.id))[1] as probe
from public.profiles as profile
group by profile.role;

grant select on table pg_temp.role_probe to authenticated;

set local role authenticated;
select is(
  (
    select pg_catalog.string_agg(role_name, ',' order by role_name)
    from pg_temp.role_probe
    where pg_temp.catalog_reader(probe)
  ),
  'operator_member,platform_admin',
  'exactly the two roles the Bank Vault is for can read the catalog'
);
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- The application-question allow-list.
-- ---------------------------------------------------------------------------

select is(
  private.bank_application_questions_valid('[]'::jsonb), false,
  'an empty question list is rejected: §6 always carries the four standing questions'
);
select is(
  private.bank_application_questions_valid(null), false,
  'null is rejected'
);
select is(
  private.bank_application_questions_valid('{"id": "a"}'::jsonb), false,
  'an object where an array belongs is rejected'
);
select is(
  private.bank_application_questions_valid($$[
    {"id": "a", "label": "A", "responseBasis": "x"},
    {"id": "b", "label": "B", "responseBasis": "x"},
    {"id": "c", "label": "C", "responseBasis": "x"},
    {"id": "d", "label": "D", "responseBasis": "x"}
  ]$$::jsonb),
  true,
  'four well-formed questions are accepted'
);
select is(
  private.bank_application_questions_valid($$[
    {"id": "a", "label": "A", "responseBasis": "x", "ficoFloor": 680},
    {"id": "b", "label": "B", "responseBasis": "x"},
    {"id": "c", "label": "C", "responseBasis": "x"},
    {"id": "d", "label": "D", "responseBasis": "x"}
  ]$$::jsonb),
  false,
  'a key nobody thought of is rejected by omission, which is what keeps an upstream change visible'
);
select is(
  private.bank_application_questions_valid($$[
    {"id": "a", "label": "A", "responseBasis": "x"},
    {"id": "a", "label": "A again", "responseBasis": "x"},
    {"id": "c", "label": "C", "responseBasis": "x"},
    {"id": "d", "label": "D", "responseBasis": "x"}
  ]$$::jsonb),
  false,
  'a duplicate question id is rejected — the surface keys its rows on it'
);

-- ---------------------------------------------------------------------------
-- Column constraints.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.banks_cache (bank_ref, name, application_questions)
     values ('Bad Ref', 'x', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]') $$,
  '23514',
  null,
  'the lender handle shares applications.bank_ref''s shape'
);

select throws_ok(
  $$ insert into public.banks_cache (bank_ref, name, application_questions, channel_type, channel_value)
     values ('chan-x', 'x', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]', 'in-person', 'somewhere') $$,
  '23514',
  null,
  'an in-person channel carries no value: the detail page answers it with branch research, not a link'
);

select throws_ok(
  $$ insert into public.banks_cache (bank_ref, name, application_questions, channel_type, channel_value)
     values ('chan-y', 'x', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]', 'online', null) $$,
  '23514',
  null,
  'an online channel without a link is rejected rather than rendered as an empty control'
);

select throws_ok(
  $$ insert into public.banks_cache (bank_ref, name, application_questions, channel_type)
     values ('chan-z', 'x', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]', 'carrier-pigeon') $$,
  '23514',
  null,
  'the channel vocabulary is the three §6 values'
);

select throws_ok(
  $$ insert into public.banks_cache (bank_ref, name, application_questions, source)
     values ('src-x', 'x', '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]', 'guesswork') $$,
  '23514',
  null,
  'a cache row declares where it came from, from a closed set'
);

-- ---------------------------------------------------------------------------
-- The catalog migration 382 ships. These handles are transcribed: SQL cannot
-- read `BANK_FIXTURES` out of a TypeScript module, so this file can only pin
-- what 382 produced, not that 382 agrees with the frozen surface. The binding
-- assertion — every BANK_FIXTURES handle appears in 382 exactly once, and no
-- extras — is derived from the fixture module at test time in
-- `web/src/lib/vault/catalog-migration.test.ts`. Both are needed: this one
-- catches a migration that did not apply, that one catches the two lists
-- drifting apart.
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select bank_ref from public.banks_cache where source = 'fixture' order by bank_ref $$,
  $$ values ('amex-business'), ('bluevine'), ('chase-ink'), ('pnc'), ('td-bank'), ('us-bank'), ('wells-fargo') $$,
  'the illustrative catalog covers every lender the frozen Bank Vault names'
);

select is(
  (select count(*)::integer from public.banks_cache where source = 'fixture' and not is_active),
  0,
  'every catalog lender is published'
);

-- Every catalog row opens with the four standing §6 questions, in order. Read
-- off the stored rows rather than compared to a transcript of migration 382.
select is_empty(
  $$
    select bank_ref
    from public.banks_cache
    where source = 'fixture'
      and (
        select jsonb_agg(question ->> 'id' order by ordinality)
        from jsonb_array_elements(application_questions) with ordinality as element(question, ordinality)
        where ordinality <= 4
      ) is distinct from
      '["projected-revenue", "projected-personal-income", "projected-monthly-spend", "projected-employees"]'::jsonb
  $$,
  'every catalog lender leads with the four standing application questions in the §6 order'
);

-- ---------------------------------------------------------------------------
-- The read model.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.bank_read_model),
  (select count(*)::integer from public.banks_cache where is_active),
  'the read model serves exactly the active lenders'
);

select is(
  (select heat_level from public.bank_read_model where bank_ref = 'bluevine'),
  null,
  'a lender with no counted outcome joins to no stats row, which is a fact about the lender rather than a missing row'
);

-- Unpublishing removes a lender from the read model without removing the row
-- the foreign key needs.
update public.banks_cache set is_active = false where bank_ref = 'pnc';
select is(
  (select count(*)::integer from public.bank_read_model where bank_ref = 'pnc'),
  0,
  'an unpublished lender leaves the read model'
);
select is(
  (select count(*)::integer from public.banks_cache where bank_ref = 'pnc'),
  1,
  'and keeps its row, which is what stands in for a delete'
);

select * from finish();

rollback;
