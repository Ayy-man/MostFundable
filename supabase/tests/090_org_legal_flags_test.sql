-- 090_org_legal_flags_test.sql
--
-- The executable oracle for the legal gate's storage. DEC-D7 says the upfront
-- admin fee is "built gated: do not un-gate without written legal sign-off",
-- and names three conditions — platform admin only, after sign-off, never by
-- default. Each of the three maps to a case below, so the lock is a tested fact
-- rather than a sentence in a decision log.
--
-- Fixtures live in the 00000000-0000-0000-0000-0000000012xx block, which is
-- Phase 12's reservation on a local stack shared with Phases 10, 11 and 13, and
-- the whole file runs inside begin … rollback so nothing survives into another
-- lane's run.

begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

insert into public.orgs (id, name, slug)
values
  (
    '00000000-0000-0000-0000-000000001201',
    'Phase 12 Fee Gate Org A',
    'phase-12-fee-gate-a'
  ),
  (
    '00000000-0000-0000-0000-000000001202',
    'Phase 12 Fee Gate Org B',
    'phase-12-fee-gate-b'
  );

insert into auth.users (id, email, raw_app_meta_data)
values
  (
    '00000000-0000-0000-0000-000000001211',
    'owner.a.phase12-fees@test.example',
    jsonb_build_object(
      'app_role', 'operator_member',
      'full_name', 'Phase 12 Org A Owner',
      'org_id', '00000000-0000-0000-0000-000000001201',
      'org_role', 'owner'
    )
  ),
  (
    '00000000-0000-0000-0000-000000001212',
    'admin.phase12-fees@test.example',
    jsonb_build_object(
      'app_role', 'platform_admin',
      'full_name', 'Phase 12 Platform Admin'
    )
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '00000000-0000-0000-0000-000000001211',
    'operator_member',
    '00000000-0000-0000-0000-000000001201',
    'owner',
    'Phase 12 Org A Owner',
    'owner.a.phase12-fees@test.example'
  ),
  (
    '00000000-0000-0000-0000-000000001212',
    'platform_admin',
    null,
    null,
    'Phase 12 Platform Admin',
    'admin.phase12-fees@test.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

-- ---------------------------------------------------------------------------
-- Shape.
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'org_flags',
  'the legal flag lives in its own table rather than as a column on another lane''s orgs'
);

select has_pk(
  'public',
  'org_flags',
  'org_flags has a primary key, so an organization cannot hold two contradictory flag rows'
);

select is(
  (
    select constraint_row.confdeltype
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.org_flags'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.orgs'::regclass
  ),
  'c'::"char",
  'the organization reference cascades on delete, so a removed tenant leaves no orphan flag'
);

-- DEC-D7's "never a config default", proven at the column.
select col_default_is(
  'org_flags',
  'upfront_fee_approved',
  false,
  'the flag defaults to false, so a row created by any path starts closed'
);

-- ---------------------------------------------------------------------------
-- The sign-off CHECK, proven one branch at a time.
-- ---------------------------------------------------------------------------
--
-- Proving the constraint once with all three columns null would pass even if
-- the constraint only tested one of them.

select throws_ok(
  $$
    insert into public.org_flags (
      org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
    ) values (
      '00000000-0000-0000-0000-000000001201',
      true,
      null,
      '00000000-0000-0000-0000-000000001212',
      now()
    )
  $$,
  '23514',
  null,
  'approval without a sign-off reference is rejected'
);

select throws_ok(
  $$
    insert into public.org_flags (
      org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
    ) values (
      '00000000-0000-0000-0000-000000001201',
      true,
      'legal-2026-08-16-phase12',
      null,
      now()
    )
  $$,
  '23514',
  null,
  'approval with no named approver is rejected'
);

select throws_ok(
  $$
    insert into public.org_flags (
      org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
    ) values (
      '00000000-0000-0000-0000-000000001201',
      true,
      'legal-2026-08-16-phase12',
      '00000000-0000-0000-0000-000000001212',
      null
    )
  $$,
  '23514',
  null,
  'approval with no approval timestamp is rejected'
);

-- A foreign key can only prove the profile exists, not that it was allowed to
-- approve, which is what this trigger adds.
select throws_ok(
  $$
    insert into public.org_flags (
      org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
    ) values (
      '00000000-0000-0000-0000-000000001202',
      true,
      'legal-2026-08-16-phase12',
      '00000000-0000-0000-0000-000000001211',
      now()
    )
  $$,
  '22023',
  null,
  'an operator owner cannot be recorded as the approver'
);

select lives_ok(
  $$
    insert into public.org_flags (
      org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
    ) values (
      '00000000-0000-0000-0000-000000001202',
      true,
      'legal-2026-08-16-phase12',
      '00000000-0000-0000-0000-000000001212',
      now()
    )
  $$,
  'an approval carrying reference, approver and timestamp is accepted'
);

-- ---------------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------------

select policies_are(
  'public',
  'org_flags',
  array['org_flags_read', 'org_flags_platform_write']::name[],
  'org_flags carries exactly the read and platform-write policies, so a later addition fails loudly'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.org_flags'::regclass),
  true,
  'row level security is enabled on org_flags'
);

select is(
  (select relforcerowsecurity from pg_class where oid = 'public.org_flags'::regclass),
  true,
  'row level security is forced on org_flags, so the table owner is not exempt'
);

-- ---------------------------------------------------------------------------
-- Who may read and who may write.
-- ---------------------------------------------------------------------------

insert into public.org_flags (org_id) values ('00000000-0000-0000-0000-000000001201');

create temp table phase12_audit_baseline as
select count(*) as row_count from public.audit_log;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000001211'
  )::text,
  true
);

select is(
  (
    select count(*)::integer
    from public.org_flags
    where org_id = '00000000-0000-0000-0000-000000001201'
  ),
  1,
  'an operator owner can see whether their own organization is gated'
);

select is(
  (
    select count(*)::integer
    from public.org_flags
    where org_id = '00000000-0000-0000-0000-000000001202'
  ),
  0,
  'an operator owner cannot see another organization''s gate state'
);

-- A data-modifying CTE is only legal at the top level of a statement, so the
-- affected-row count is captured into a temp table rather than read inside the
-- assertion's scalar subquery.
create temp table phase12_owner_attempt as
with attempted as (
  update public.org_flags
  set
    upfront_fee_approved = true,
    legal_signoff_ref = 'self-approved-2026-08-16',
    approved_by = '00000000-0000-0000-0000-000000001211',
    approved_at = now()
  where org_id = '00000000-0000-0000-0000-000000001201'
  returning 1
)
select count(*)::integer as row_count from attempted;

select is(
  (select row_count from phase12_owner_attempt),
  0,
  'an operator owner approving their own organization affects zero rows'
);

reset role;

select is(
  (
    select upfront_fee_approved
    from public.org_flags
    where org_id = '00000000-0000-0000-0000-000000001201'
  ),
  false,
  'the organization is still gated after the owner''s attempt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000001212'
  )::text,
  true
);

create temp table phase12_admin_approval as
with approved as (
  update public.org_flags
  set
    upfront_fee_approved = true,
    legal_signoff_ref = 'legal-2026-08-16-phase12',
    approved_by = '00000000-0000-0000-0000-000000001212',
    approved_at = now()
  where org_id = '00000000-0000-0000-0000-000000001201'
  returning 1
)
select count(*)::integer as row_count from approved;

select is(
  (select row_count from phase12_admin_approval),
  1,
  'a platform admin approving an organization affects exactly one row'
);

reset role;

-- ---------------------------------------------------------------------------
-- Audit composition.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.audit_log)
    - (select row_count from phase12_audit_baseline),
  1::bigint,
  'the approval left exactly one new audit row'
);

select is(
  (
    select entry.action || ' ' || entry.subject_type || ' ' || entry.subject_id::text
    from public.audit_log as entry
    where entry.org_id = '00000000-0000-0000-0000-000000001201'
      and entry.action = 'org_flags.upfront_fee_approved.changed'
  ),
  'org_flags.upfront_fee_approved.changed org_flags 00000000-0000-0000-0000-000000001201',
  'the audit row names the action, the subject type and the organization it is about'
);

select is(
  (
    select private.audit_meta_valid(entry.meta)
    from public.audit_log as entry
    where entry.org_id = '00000000-0000-0000-0000-000000001201'
      and entry.action = 'org_flags.upfront_fee_approved.changed'
  ),
  true,
  'the audit metadata satisfies the Phase-1 allow-list without that function being edited'
);

select is(
  (
    select entry.meta
    from public.audit_log as entry
    where entry.org_id = '00000000-0000-0000-0000-000000001201'
      and entry.action = 'org_flags.upfront_fee_approved.changed'
  ),
  jsonb_build_object(
    'from_state', 'false',
    'source', 'org_flags',
    'to_state', 'true'
  ),
  'the audit metadata records the state it moved from and to'
);

select is(
  (
    select entry.actor_profile_id
    from public.audit_log as entry
    where entry.org_id = '00000000-0000-0000-0000-000000001201'
      and entry.action = 'org_flags.upfront_fee_approved.changed'
  ),
  '00000000-0000-0000-0000-000000001212'::uuid,
  'the audit row attributes the approval to the platform admin who made it'
);

-- UPDATE OF fires on assignment, not on change, so an update that leaves the
-- flag where it was must not manufacture a second audit row.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000001212'
  )::text,
  true
);

update public.org_flags
set legal_signoff_ref = 'legal-2026-08-16-phase12-amended'
where org_id = '00000000-0000-0000-0000-000000001201';

reset role;

select is(
  (select count(*) from public.audit_log)
    - (select row_count from phase12_audit_baseline),
  1::bigint,
  'an edit that does not move the flag leaves no new audit row'
);

-- D-15: revocation is itself a change, and is recorded like one.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000001212'
  )::text,
  true
);

update public.org_flags
set
  upfront_fee_approved = false,
  legal_signoff_ref = null,
  approved_by = null,
  approved_at = null
where org_id = '00000000-0000-0000-0000-000000001201';

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_log as entry
    where entry.org_id = '00000000-0000-0000-0000-000000001201'
      and entry.action = 'org_flags.upfront_fee_approved.changed'
      and entry.meta ->> 'to_state' = 'false'
  ),
  1,
  'revoking the approval is audited as its own change'
);

-- ---------------------------------------------------------------------------
-- Nothing sets the flag by default.
-- ---------------------------------------------------------------------------
--
-- The static half of this proof — that no seed file and no environment example
-- names the flag — lives in web/scripts/verify-fee-legal-gate.mjs. This is the
-- database half, and both are kept because the seed and the schema can drift
-- independently of each other.

select is(
  (
    select count(*)::integer
    from public.org_flags
    where upfront_fee_approved
      and org_id not in (
        '00000000-0000-0000-0000-000000001201',
        '00000000-0000-0000-0000-000000001202'
      )
  ),
  0,
  'no organization outside this test''s own fixtures carries an approved gate'
);

select * from finish();

rollback;
