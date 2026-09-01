begin;

set local search_path = public, extensions;

select plan(64);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['amex-business-line', 'chase-business-ink']) as handle
on conflict (bank_ref) do nothing;

-- ---------------------------------------------------------------------------
-- Structure. APPS-01's four tables and the eight enums that keep their status
-- columns closed. The enum label lists are the authority the TypeScript unions
-- in `web/src/lib/applications/types.ts` copy, so a drift here is a type error
-- there rather than a runtime surprise.
-- ---------------------------------------------------------------------------

select has_table('public', 'applications', 'applications table exists');
select has_table('public', 'application_notes', 'application notes table exists');
select has_table('public', 'outcomes', 'outcomes table exists');
select has_table('public', 'outcome_reviews', 'outcome reviews table exists');

select has_type('public', 'application_operator_status', 'operator status enum exists');
select has_type('public', 'application_consumer_status', 'consumer status enum exists');
select has_type('public', 'application_visibility', 'application visibility enum exists');
select has_type('public', 'application_note_author_kind', 'note author kind enum exists');
select has_type('public', 'outcome_kind', 'outcome kind enum exists');
select has_type('public', 'outcome_state', 'outcome state enum exists');
select has_type('public', 'outcome_review_state', 'outcome review state enum exists');
select has_type('public', 'outcome_notification_kind', 'outcome notification kind enum exists');

select enum_has_labels(
  'public',
  'application_operator_status',
  array['wait', 'todo'],
  'operator status is the two-value work queue'
);
select enum_has_labels(
  'public',
  'application_consumer_status',
  array['approved', 'pending', 'denied'],
  'consumer status is the three-value outcome the consumer sees'
);
select enum_has_labels(
  'public',
  'application_visibility',
  array['inherit', 'details', 'status_only'],
  'visibility is the three-value per-application override'
);
select enum_has_labels(
  'public',
  'application_note_author_kind',
  array['consumer', 'operator'],
  'note author kind names the two sides of the shared thread'
);
select enum_has_labels(
  'public',
  'outcome_kind',
  array['approved', 'denied', 'withdrawn'],
  'outcome kind is the closed three-value set'
);
select enum_has_labels(
  'public',
  'outcome_state',
  array['counted', 'removed'],
  'outcome state is counted or tombstoned, nothing else'
);
select enum_has_labels(
  'public',
  'outcome_review_state',
  array['pending', 'approved', 'removed'],
  'review state carries the correction path decision'
);
select enum_has_labels(
  'public',
  'outcome_notification_kind',
  array['outcome_review_approved', 'outcome_review_removed', 'crs_alert'],
  'notification kind preserves Phase 11 values and appends the ancillary alert kind'
);

-- APPS-02, stated as literally as the requirement allows: the entry counts
-- because the column defaults to counted, not because a code path said so.
select col_default_is(
  'public',
  'outcomes',
  'state',
  'counted',
  'an outcome counts on insert because the column default says so'
);

select matches(
  (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'outcomes_one_counted_per_application'
  ),
  '(?i)where \(state = ''counted''',
  'the one-counted index is partial; a plain unique key would make a correction impossible'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'applications_client_bank_unique',
        'applications_id_bank_unique',
        'outcomes_one_counted_per_application',
        'outcome_reviews_outcome_id_key'
      )
  ),
  4,
  'the uniqueness keys this phase depends on all exist'
);

-- ---------------------------------------------------------------------------
-- Fixtures, built inside the transaction. `supabase/seed.sql` is
-- integration-owned and is never read or written here.
--
-- The profiles insert upserts because migration 010's `on_auth_user_created`
-- trigger already wrote a narrow fallback row for each `auth.users` insert;
-- this fixture needs real roles bound to a real organization.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('bb000000-0000-0000-0000-000000000011', 'operator.one@applications.example'),
  ('bb000000-0000-0000-0000-000000000012', 'consumer.one@applications.example'),
  ('bb000000-0000-0000-0000-000000000013', 'admin.one@applications.example');

insert into public.orgs (id, name, slug)
values ('bb000000-0000-0000-0000-000000000001', 'Applications Org One', 'applications-org-one');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    'bb000000-0000-0000-0000-000000000011',
    'operator_member',
    'bb000000-0000-0000-0000-000000000001',
    'owner',
    'Applications Operator One',
    'operator.one@applications.example'
  ),
  (
    'bb000000-0000-0000-0000-000000000012',
    'consumer',
    'bb000000-0000-0000-0000-000000000001',
    null,
    'Applications Consumer One',
    'consumer.one@applications.example'
  ),
  (
    'bb000000-0000-0000-0000-000000000013',
    'platform_admin',
    null,
    null,
    'Applications Admin One',
    'admin.one@applications.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values (
  'bb000000-0000-0000-0000-000000000101',
  'bb000000-0000-0000-0000-000000000001',
  'bb000000-0000-0000-0000-000000000012',
  'Applications Client One',
  'bb000000-0000-0000-0000-000000000011'
);

-- ---------------------------------------------------------------------------
-- APPS-01 — the application row, its bank handle and its one-tab-per-bank rule.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.applications (client_id, bank_ref, created_by)
    values (
      'bb000000-0000-0000-0000-000000000101',
      'Bad Ref',
      'bb000000-0000-0000-0000-000000000011'
    )
  $$,
  '23514',
  null,
  'a bank handle outside the format check is rejected'
);

select lives_ok(
  $$
    insert into public.applications (id, client_id, bank_ref, created_by)
    values (
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000101',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000011'
    )
  $$,
  'a well-formed bank handle is accepted'
);

select results_eq(
  $$
    select
      operator_status::text collate "C",
      consumer_status::text collate "C",
      visibility::text collate "C"
    from public.applications
    where id = 'bb000000-0000-0000-0000-000000000201'
  $$,
  $$
    values (
      'wait'::text collate "C",
      'pending'::text collate "C",
      'inherit'::text collate "C"
    )
  $$,
  'a new application starts at wait, pending and inherit'
);

select throws_ok(
  $$
    insert into public.applications (client_id, bank_ref, created_by)
    values (
      'bb000000-0000-0000-0000-000000000101',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000011'
    )
  $$,
  '23505',
  null,
  'one tab per bank per client: the second application on the same bank is rejected'
);

select throws_ok(
  $$
    insert into public.applications (client_id, bank_ref, amount_cents, created_by)
    values (
      'bb000000-0000-0000-0000-000000000101',
      'amex-business-line',
      -1,
      'bb000000-0000-0000-0000-000000000011'
    )
  $$,
  '23514',
  null,
  'a negative requested amount is rejected'
);

-- ---------------------------------------------------------------------------
-- APPS-01 — the shared note thread, with the operator attestation as a
-- constraint rather than a checkbox some form remembers to render.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.application_notes (
      application_id, author_profile_id, author_kind, body, attested
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000011',
      'operator',
      'Spoke to the lender about this file.',
      false
    )
  $$,
  '23514',
  null,
  'an operator note without its attestation is rejected'
);

select lives_ok(
  $$
    insert into public.application_notes (
      id, application_id, author_profile_id, author_kind, body, attested
    ) values (
      'bb000000-0000-0000-0000-000000000301',
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000011',
      'operator',
      'Spoke to the lender about this file.',
      true
    )
  $$,
  'an attested operator note is accepted'
);

select throws_ok(
  $$
    insert into public.application_notes (
      application_id, author_profile_id, author_kind, body, attested
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000012',
      'consumer',
      'Uploaded the statement you asked for.',
      true
    )
  $$,
  '23514',
  null,
  'a consumer note cannot carry the operator attestation'
);

select lives_ok(
  $$
    insert into public.application_notes (
      application_id, author_profile_id, author_kind, body, attested
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000012',
      'consumer',
      'Uploaded the statement you asked for.',
      false
    )
  $$,
  'an unattested consumer note is accepted'
);

select throws_ok(
  $$
    insert into public.application_notes (
      application_id, author_profile_id, author_kind, body, attested
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'bb000000-0000-0000-0000-000000000012',
      'consumer',
      '',
      false
    )
  $$,
  '23514',
  null,
  'an empty note body is rejected'
);

select throws_ok(
  format(
    $$
      insert into public.application_notes (
        application_id, author_profile_id, author_kind, body, attested
      ) values (
        'bb000000-0000-0000-0000-000000000201',
        'bb000000-0000-0000-0000-000000000012',
        'consumer',
        %L,
        false
      )
    $$,
    repeat('a', 4001)
  ),
  '23514',
  null,
  'a note body past the 4000-character cap is rejected'
);

select throws_ok(
  $$
    update public.application_notes
    set body = 'rewritten after the fact'
    where id = 'bb000000-0000-0000-0000-000000000301'
  $$,
  'P0001',
  'application_notes rows are append-only',
  'a note cannot be rewritten after it is posted'
);

select throws_ok(
  $$
    delete from public.application_notes
    where id = 'bb000000-0000-0000-0000-000000000301'
  $$,
  'P0001',
  'application_notes rows are append-only',
  'a note cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- APPS-02 — the outcome counts on entry, carries a coherent amount, and can be
-- corrected exactly once at a time.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.outcomes (
      application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'approved',
      null,
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  '23514',
  null,
  'an approved outcome with no amount is rejected, so the approved-amount sum cannot under-count'
);

select throws_ok(
  $$
    insert into public.outcomes (
      application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'approved',
      0,
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  '23514',
  null,
  'an approved outcome of zero is rejected'
);

select throws_ok(
  $$
    insert into public.outcomes (
      application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'denied',
      500000,
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  '23514',
  null,
  'a non-approved outcome carrying an amount is rejected'
);

select throws_ok(
  $$
    insert into public.outcomes (
      application_id, bank_ref, client_id, kind, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'amex-business-line',
      'bb000000-0000-0000-0000-000000000101',
      'denied',
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  '23503',
  null,
  'an outcome cannot be filed against a bank its application does not name'
);

select lives_ok(
  $$
    insert into public.outcomes (
      id, application_id, bank_ref, client_id, kind, amount_cents, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000401',
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'approved',
      2500000,
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  'a well-formed approved outcome is accepted'
);

select is(
  (
    select state::text
    from public.outcomes
    where id = 'bb000000-0000-0000-0000-000000000401'
  ),
  'counted',
  'the outcome is counted the moment it exists, with no review consulted'
);

select throws_ok(
  $$
    insert into public.outcomes (
      application_id, bank_ref, client_id, kind, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'denied',
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  '23505',
  null,
  'a second counted outcome on one application is rejected'
);

select throws_ok(
  $$
    update public.outcomes
    set state = 'removed'
    where id = 'bb000000-0000-0000-0000-000000000401'
  $$,
  '23514',
  null,
  'a tombstone with no actor and no moment is rejected'
);

select lives_ok(
  $$
    update public.outcomes
    set state = 'removed',
        removed_at = now(),
        removed_by = 'bb000000-0000-0000-0000-000000000013'
    where id = 'bb000000-0000-0000-0000-000000000401'
  $$,
  'a tombstone naming its actor and its moment is accepted'
);

select lives_ok(
  $$
    insert into public.outcomes (
      id, application_id, bank_ref, client_id, kind, recorded_by, recorded_by_kind
    ) values (
      'bb000000-0000-0000-0000-000000000402',
      'bb000000-0000-0000-0000-000000000201',
      'chase-business-ink',
      'bb000000-0000-0000-0000-000000000101',
      'denied',
      'bb000000-0000-0000-0000-000000000011',
      'operator'
    )
  $$,
  'the corrected entry is accepted once the earlier one is tombstoned, which is what the partial predicate buys'
);

-- ---------------------------------------------------------------------------
-- The correction record itself.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.outcome_reviews (outcome_id, state)
    values ('bb000000-0000-0000-0000-000000000402', 'approved')
  $$,
  '23514',
  null,
  'a decided review with no reviewer and no timestamp is rejected'
);

select throws_ok(
  $$
    insert into public.outcome_reviews (outcome_id, state, reviewed_by, reviewed_at)
    values (
      'bb000000-0000-0000-0000-000000000402',
      'pending',
      'bb000000-0000-0000-0000-000000000013',
      now()
    )
  $$,
  '23514',
  null,
  'a pending review carrying a reviewer is rejected'
);

-- Migration 081 puts this row in place with the outcome, in the same
-- transaction, so the claim is now about what the schema guarantees rather than
-- about what a hand-written insert is allowed to do.
select results_eq(
  $$
    select state::text collate "C", reviewed_by, reviewed_at
    from public.outcome_reviews
    where outcome_id = 'bb000000-0000-0000-0000-000000000402'
  $$,
  $$ values ('pending'::text collate "C", null::uuid, null::timestamptz) $$,
  'a review opens pending with no reviewer'
);

select throws_ok(
  $$
    insert into public.outcome_reviews (outcome_id)
    values ('bb000000-0000-0000-0000-000000000402')
  $$,
  '23505',
  null,
  'an outcome carries at most one review row'
);

-- ---------------------------------------------------------------------------
-- Access. Tenancy reuses Phase 1's single definition; the correction path is
-- out of an operator's reach at the grant level, not only inside a policy body.
-- ---------------------------------------------------------------------------

select is(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'applications'
  ),
  true,
  'applications enables row security'
);
select is(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'application_notes'
  ),
  true,
  'application notes enables row security'
);
select is(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'outcomes'
  ),
  true,
  'outcomes enables row security'
);
select is(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'outcome_reviews'
  ),
  true,
  'outcome reviews enables row security'
);

select is(
  (
    select bool_and(relation.relforcerowsecurity)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'applications', 'application_notes', 'outcomes', 'outcome_reviews'
      )
  ),
  true,
  'all four tables force row security, so the owner is not exempt'
);

select is(
  has_table_privilege('anon', 'public.applications', 'select'),
  false,
  'anonymous cannot read applications'
);
select is(
  has_table_privilege('anon', 'public.application_notes', 'select'),
  false,
  'anonymous cannot read the note thread'
);
select is(
  has_table_privilege('anon', 'public.outcomes', 'select'),
  false,
  'anonymous cannot read outcomes'
);
select is(
  has_table_privilege('anon', 'public.outcome_reviews', 'select'),
  false,
  'anonymous cannot read the correction queue'
);

select is(
  has_table_privilege('authenticated', 'public.outcome_reviews', 'insert'),
  false,
  'an operator cannot open a correction record directly'
);
select is(
  has_table_privilege('authenticated', 'public.outcome_reviews', 'update'),
  false,
  'an operator cannot decide a correction record directly'
);
select is(
  has_table_privilege('authenticated', 'public.outcome_reviews', 'select'),
  true,
  'an operator can see the state of a correction on its own client'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'applications', 'application_notes', 'outcomes', 'outcome_reviews'
      )
      and coalesce(qual, '') !~ 'can_access_client'
      and coalesce(with_check, '') !~ 'can_access_client'
  ),
  0,
  'every policy on the four tables reaches tenancy through the Phase 1 helper'
);

-- D-10: no stage machinery is introduced here. Asserted against the catalog
-- rather than the file, so it holds for whatever actually got applied.
select is(
  (
    select count(*)::integer
    from pg_trigger as trg
    join pg_class as relation on relation.oid = trg.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_proc as fn on fn.oid = trg.tgfoid
    where namespace.nspname = 'public'
      and relation.relname in (
        'applications', 'application_notes', 'outcomes', 'outcome_reviews'
      )
      and fn.prosrc ~ '(stage_history|stage_entered_at|clients\.stage)'
  ),
  0,
  'no trigger on this phase''s tables touches the tracker stage machinery'
);

select * from finish();

rollback;
