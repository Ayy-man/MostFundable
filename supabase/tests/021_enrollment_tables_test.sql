begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-0000000000b2',
    'authenticated', 'authenticated', 'lane-b-consumer@example.test', '',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-0000000000b8',
    'authenticated', 'authenticated', 'lane-b-other@example.test', '',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-0000000000ba',
    'authenticated', 'authenticated', 'lane-b-operator@example.test', '',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  ),
  (
    '00000000-0000-0000-0000-0000000000bb',
    'authenticated', 'authenticated', 'lane-b-affiliate@example.test', '',
    pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
  )
on conflict do nothing;

insert into public.orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000b0', 'Lane B Test Org', 'lane-b-test'),
  ('00000000-0000-0000-0000-0000000000b7', 'Lane B Other Org', 'lane-b-other')
on conflict do nothing;

insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  (
    '00000000-0000-0000-0000-0000000000b2',
    'consumer', '00000000-0000-0000-0000-0000000000b0', null,
    'Lane B Consumer', 'lane-b-consumer@example.test'
  ),
  (
    '00000000-0000-0000-0000-0000000000b8',
    'consumer', '00000000-0000-0000-0000-0000000000b7', null,
    'Lane B Other Consumer', 'lane-b-other@example.test'
  ),
  (
    '00000000-0000-0000-0000-0000000000ba',
    'operator_member', '00000000-0000-0000-0000-0000000000b0', 'owner',
    'Lane B Operator', 'lane-b-operator@example.test'
  ),
  (
    '00000000-0000-0000-0000-0000000000bb',
    'affiliate', '00000000-0000-0000-0000-0000000000b0', null,
    'Lane B Affiliate', 'lane-b-affiliate@example.test'
  )
-- Upsert, not a plain insert: migration 010's `on_auth_user_created` trigger
-- writes a `public.profiles` row for every `auth.users` insert, so by the time
-- this statement runs each row already exists and a plain insert raises 23505.
-- The trigger's row is the narrow fallback shape — role `consumer`, `org_id`
-- null — and this fixture needs real roles bound to real organizations, so the
-- conflict resolves as `do update`: the fixture decides the final values, not
-- the fallback. `do nothing` is wrong here for the same reason; it leaves the
-- fallback row in place and the client insert then fails its role check.
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (
  id, org_id, consumer_profile_id, display_name
) values
  (
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000b0',
    '00000000-0000-0000-0000-0000000000b2',
    'Lane B Test Client'
  ),
  (
    '00000000-0000-0000-0000-0000000000b9',
    '00000000-0000-0000-0000-0000000000b7',
    '00000000-0000-0000-0000-0000000000b8',
    'Lane B Other Client'
  )
on conflict do nothing;

insert into public.consents (
  id, client_id, kind, text_version, signed_at, ip, esig_ref
) values
  (
    '00000000-0000-0000-0000-0000000000b3',
    '00000000-0000-0000-0000-0000000000b1',
    'monitoring',
    'monitoring-2026-08-16.1',
    '2026-08-16T00:00:00Z',
    '127.0.0.1',
    '00000000-0000-0000-0000-0000000000b4'
  ),
  (
    '00000000-0000-0000-0000-0000000000bc',
    '00000000-0000-0000-0000-0000000000b1',
    'analysis',
    'analysis-2026-08-16.1',
    '2026-08-16T00:00:00Z',
    '127.0.0.1',
    '00000000-0000-0000-0000-0000000000b4'
  )
on conflict do nothing;

insert into public.esignatures (
  id, client_id, document_kind, text_version, signer_name,
  typed_signature, signed_at, client_draft_id
) values (
  '00000000-0000-0000-0000-0000000000b4',
  '00000000-0000-0000-0000-0000000000b1',
  'enrollment_agreement',
  'agreement-2026-08-16.1',
  'Lane B Consumer',
  'Lane B Consumer',
  '2026-08-16T00:00:00Z',
  '00000000-0000-4000-8000-0000000000b4'
) on conflict do nothing;

insert into public.enrollments (
  id, client_id, status, esig_doc_id,
  monitoring_consent_at, analysis_consent_at
) values (
  '00000000-0000-0000-0000-0000000000b5',
  '00000000-0000-0000-0000-0000000000b1',
  'enrolled',
  '00000000-0000-0000-0000-0000000000b4',
  '2026-08-16T00:00:00Z',
  '2026-08-16T00:00:00Z'
) on conflict do nothing;

insert into public.idv_sessions (
  id, enrollment_id, client_id, member_ref, driver, kind, state, max_attempts
) values (
  '00000000-0000-0000-0000-0000000000b6',
  '00000000-0000-0000-0000-0000000000b5',
  '00000000-0000-0000-0000-0000000000b1',
  'mock_member_lane_b',
  'mock',
  'sms',
  'sms_sent',
  2
) on conflict do nothing;

select throws_ok(
  $$
    update public.esignatures
    set signer_name = 'Changed'
    where id = '00000000-0000-0000-0000-0000000000b4'
  $$,
  '42501', null, 'an e-signature cannot be updated'
);

select throws_ok(
  $$
    delete from public.esignatures
    where id = '00000000-0000-0000-0000-0000000000b4'
  $$,
  '42501', null, 'an e-signature cannot be deleted'
);

select is(
  (select tgenabled from pg_trigger where tgname = 'esignatures_append_only'),
  'A', 'the e-signature row guard is always enabled'
);
select is(
  (select tgenabled from pg_trigger where tgname = 'esignatures_no_truncate'),
  'A', 'the e-signature table guard is always enabled'
);
select is(
  (select tgenabled from pg_trigger where tgname = 'consent_revocations_append_only'),
  'A', 'the revocation row guard is always enabled'
);
select is(
  (select tgenabled from pg_trigger where tgname = 'consent_revocations_no_truncate'),
  'A', 'the revocation table guard is always enabled'
);

select is_empty(
  $$
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('esignatures', 'consent_revocations')
      and grantee = 'service_role'
      and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
  $$,
  'service_role has no mutation grant on retained agreement artifacts'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::integer from public.esignatures),
  1, 'the owning consumer reads their e-signature'
);
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b8","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::integer from public.esignatures),
  0, 'a consumer in another org reads no e-signature'
);
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ba","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::integer from public.esignatures),
  1, 'an operator in the owning org reads the e-signature'
);
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}';
set local role authenticated;
select is(
  (
    (select count(*) from public.esignatures)
    + (select count(*) from public.consent_revocations)
    + (select count(*) from public.idv_sessions)
  )::integer,
  0, 'an affiliate reads none of the three enrollment artifact tables'
);
reset role;

select lives_ok(
  $$ select public.enrollment_revoke_consent(
    '00000000-0000-0000-0000-0000000000b1',
    'monitoring',
    '00000000-0000-0000-0000-0000000000b2'
  ) $$,
  'withdrawing authorization appends a revocation row'
);

select results_eq(
  $$
    select id::text, signed_at::text
    from public.consents
    where id = '00000000-0000-0000-0000-0000000000b3'
  $$,
  $$ values (
    '00000000-0000-0000-0000-0000000000b3',
    '2026-08-16 00:00:00+00'
  ) $$,
  'recording a revocation leaves the original consent unchanged'
);

select throws_ok(
  $$
    insert into public.consent_revocations (
      consent_id, client_id, kind, revoked_by
    ) values (
      '00000000-0000-0000-0000-0000000000b3',
      '00000000-0000-0000-0000-0000000000b1',
      'monitoring',
      '00000000-0000-0000-0000-0000000000b2'
    )
  $$,
  '23505', null, 'a repeated revocation cannot append a second row'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where action in (
      'consent.create',
      'consent.revoke',
      'enrollment.create',
      'enrollment.idv_started'
    )
      and client_id = '00000000-0000-0000-0000-0000000000b1'
  ),
  5, 'each fixture transition writes one audit row'
);

select lives_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'agreement_signed',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  'agreement_signed is reachable through the milestone recorder'
);

select is(
  (
    select actor_profile_id::text
    from public.audit_log
    where action = 'milestone.complete'
      and subject_type = 'enrollment_milestone'
      and subject_id = '00000000-0000-0000-0000-0000000000b1'
    order by occurred_at desc
    limit 1
  ),
  '00000000-0000-0000-0000-0000000000ba',
  'the milestone audit row carries the RPC actor'
);

select lives_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'documents_uploaded',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  'documents_uploaded is reachable through the milestone recorder'
);

select lives_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'monitoring_connected',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  'monitoring_connected is reachable through the milestone recorder'
);

select lives_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'onboarding_call_completed',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  'onboarding_call_completed is reachable through the milestone recorder'
);

select lives_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'agreement_signed',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  'replaying a milestone record succeeds without replacing it'
);

select is(
  (
    select count(*)::integer
    from public.enrollment_milestones
    where client_id = '00000000-0000-0000-0000-0000000000b1'
      and kind = 'agreement_signed'
  ),
  1, 'a replay leaves exactly one milestone row'
);

select throws_ok(
  $$ select public.enrollment_record_milestone(
    '00000000-0000-0000-0000-0000000000b1',
    'unknown_kind',
    '00000000-0000-0000-0000-0000000000ba'
  ) $$,
  '22P02', null, 'an unknown milestone kind is rejected by the shared enum'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.esignatures'::regclass,
      'public.consent_revocations'::regclass,
      'public.idv_sessions'::regclass
    )
      and relrowsecurity
      and relforcerowsecurity
  ),
  3,
  'all three enrollment artifact tables enable and force row security'
);

select is_empty(
  $$
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('esignatures', 'consent_revocations', 'idv_sessions')
      and column_name in ('raw', 'payload', 'body', 'report', 'snapshot', 'tradeline')
  $$,
  'enrollment artifact tables expose no bureau-content column'
);

select * from finish();
rollback;
