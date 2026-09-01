begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000004091', 'reauthorize-owner@test.example'),
  ('00000000-0000-4000-8000-000000004092', 'reauthorize-other@test.example');
insert into public.orgs (id, name, slug)
values ('00000000-0000-4000-8000-000000004093', 'Consent reauthorization org', 'consent-reauthorization-org');
insert into public.profiles (id, role, org_id, full_name, email) values
  ('00000000-0000-4000-8000-000000004091', 'consumer', '00000000-0000-4000-8000-000000004093', 'Consent Owner', 'reauthorize-owner@test.example'),
  ('00000000-0000-4000-8000-000000004092', 'consumer', '00000000-0000-4000-8000-000000004093', 'Other Consumer', 'reauthorize-other@test.example')
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = null,
    full_name = excluded.full_name,
    email = excluded.email,
    disabled_at = null;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values (
  '00000000-0000-4000-8000-000000004094',
  '00000000-0000-4000-8000-000000004093',
  '00000000-0000-4000-8000-000000004091',
  'Consent Owner'
);

insert into public.esignatures (
  id, client_id, document_kind, text_version, signer_name, typed_signature,
  signed_at, ip, user_agent, client_draft_id
) values (
  '00000000-0000-4000-8000-000000004095',
  '00000000-0000-4000-8000-000000004094',
  'enrollment_agreement',
  'agreement-test-v1',
  'Consent Owner',
  'Consent Owner',
  '2026-08-01T00:00:00Z',
  '127.0.0.1',
  'pgtap',
  '00000000-0000-4000-8000-000000004096'
);
insert into public.consents (
  id, client_id, kind, action, text_version, signed_at, ip, esig_ref
) values
  (
    '00000000-0000-4000-8000-000000004097',
    '00000000-0000-4000-8000-000000004094',
    'analysis', 'granted', 'analysis-old-v1', '2026-08-01T00:00:00Z',
    '127.0.0.1', '00000000-0000-4000-8000-000000004095'
  ),
  (
    '00000000-0000-4000-8000-000000004098',
    '00000000-0000-4000-8000-000000004094',
    'monitoring', 'granted', 'monitoring-old-v1', '2026-08-01T00:00:00Z',
    '127.0.0.1', '00000000-0000-4000-8000-000000004095'
  );
insert into public.enrollments (
  id, client_id, crs_member_ref, status, monitoring_consent_at,
  analysis_consent_at, esig_doc_id, idpass
) values (
  '00000000-0000-4000-8000-000000004099',
  '00000000-0000-4000-8000-000000004094',
  'opaque_crs_member_409',
  'active',
  '2026-08-01T00:00:00Z',
  '2026-08-01T00:00:00Z',
  '00000000-0000-4000-8000-000000004095',
  true
);
insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, setup_intent_ref,
  payment_method_ref, subscription_ref, price_ref, price_cents, currency,
  status, idempotency_key, activated_at
) values (
  '00000000-0000-4000-8000-000000004100',
  '00000000-0000-4000-8000-000000004094',
  '00000000-0000-4000-8000-000000004099',
  'mock', 'customer_409', 'setup_409', 'payment_409', 'subscription_409',
  'price_409', 4900, 'usd', 'active', 'subscription-idempotency-409',
  '2026-08-01T00:10:00Z'
);
insert into public.consent_revocations (
  id, consent_id, client_id, kind, revoked_at, revoked_by
) values
  (
    '00000000-0000-4000-8000-000000004101',
    '00000000-0000-4000-8000-000000004097',
    '00000000-0000-4000-8000-000000004094',
    'analysis', '2026-08-02T00:00:00Z',
    '00000000-0000-4000-8000-000000004091'
  ),
  (
    '00000000-0000-4000-8000-000000004102',
    '00000000-0000-4000-8000-000000004098',
    '00000000-0000-4000-8000-000000004094',
    'monitoring', '2026-08-02T00:00:00Z',
    '00000000-0000-4000-8000-000000004091'
  );

select ok(
  not has_function_privilege(
    'authenticated',
    'public.enrollment_reauthorize_consent(uuid,uuid,text,uuid,text,text,text,inet,text)',
    'execute'
  ),
  'the browser role cannot call the signature ledger directly'
);

create temporary table analysis_reauthorization as
select * from public.enrollment_reauthorize_consent(
  '00000000-0000-4000-8000-000000004099',
  '00000000-0000-4000-8000-000000004091',
  'analysis',
  '00000000-0000-4000-8000-000000004103',
  'Consent Owner',
  'Consent Owner',
  'analysis-2026-08-16.1',
  '127.0.0.1',
  'pgtap reauthorization'
);

select is((select replayed from analysis_reauthorization), false, 'a first signature creates a new grant');
select is(
  (select count(*) from public.consents where client_id = '00000000-0000-4000-8000-000000004094' and kind = 'analysis'),
  2::bigint,
  'analysis reauthorization appends one grant'
);
select is(
  (select text_version from public.consents where id = (select consent_id from analysis_reauthorization)),
  'analysis-2026-08-16.1',
  'the new grant records the server-selected current text version'
);
select is(
  (select count(*) from public.consent_revocations where id = '00000000-0000-4000-8000-000000004101'),
  1::bigint,
  'the historical revocation remains immutable'
);
select results_eq(
  $$
    select document_kind, text_version, signer_name, typed_signature
    from public.esignatures
    where client_draft_id = '00000000-0000-4000-8000-000000004103'
  $$,
  $$values ('analysis'::text, 'analysis-2026-08-16.1'::text, 'Consent Owner'::text, 'Consent Owner'::text)$$,
  'the signature is retained as its own immutable analysis document'
);
select ok(
  public.analysis_is_authorized('00000000-0000-4000-8000-000000004094'),
  'latest-event readback authorizes analysis after the later grant'
);
select is(
  (
    select replayed
    from public.enrollment_reauthorize_consent(
      '00000000-0000-4000-8000-000000004099',
      '00000000-0000-4000-8000-000000004091',
      'analysis',
      '00000000-0000-4000-8000-000000004103',
      'Consent Owner', 'Consent Owner', 'analysis-2026-08-16.1',
      '127.0.0.2', 'pgtap retry'
    )
  ),
  true,
  'the same signed draft replays even if request metadata changes'
);
select is(
  (select count(*) from public.esignatures where client_draft_id = '00000000-0000-4000-8000-000000004103'),
  1::bigint,
  'a replay does not duplicate signature evidence'
);
select throws_ok(
  $$
    select * from public.enrollment_reauthorize_consent(
      '00000000-0000-4000-8000-000000004099',
      '00000000-0000-4000-8000-000000004092',
      'monitoring',
      '00000000-0000-4000-8000-000000004104',
      'Other Consumer', 'Other Consumer', 'monitoring-2026-08-29.1',
      '127.0.0.1', 'pgtap wrong actor'
    )
  $$,
  '42501',
  'CONSENT_ACTOR_FORBIDDEN',
  'a different consumer cannot grant the owner permission'
);
select throws_ok(
  $$
    select * from public.enrollment_reauthorize_consent(
      '00000000-0000-4000-8000-000000004099',
      '00000000-0000-4000-8000-000000004091',
      'monitoring',
      '00000000-0000-4000-8000-000000004104',
      'Consent Owner', 'Someone Else', 'monitoring-2026-08-29.1',
      '127.0.0.1', 'pgtap forged signature'
    )
  $$,
  '22023',
  'CONSENT_SIGNATURE_MISMATCH',
  'the ledger rejects a signature that does not match the owning consumer'
);
select throws_ok(
  $$
    select * from public.enrollment_reauthorize_consent(
      '00000000-0000-4000-8000-000000004099',
      '00000000-0000-4000-8000-000000004091',
      'analysis',
      '00000000-0000-4000-8000-000000004105',
      'Consent Owner', 'Consent Owner', 'analysis-2026-08-16.1',
      '127.0.0.1', 'pgtap duplicate grant'
    )
  $$,
  '23505',
  'CONSENT_ALREADY_AUTHORIZED',
  'an authorized permission cannot silently collect another grant'
);

create temporary table monitoring_reauthorization as
select * from public.enrollment_reauthorize_consent(
  '00000000-0000-4000-8000-000000004099',
  '00000000-0000-4000-8000-000000004091',
  'monitoring',
  '00000000-0000-4000-8000-000000004106',
  'Consent Owner',
  'Consent Owner',
  'monitoring-2026-08-29.1',
  '127.0.0.1',
  'pgtap monitoring reauthorization'
);

select is((select replayed from monitoring_reauthorization), false, 'monitoring uses the same signed append-only path');
select ok(
  public.monitoring_is_authorized('00000000-0000-4000-8000-000000004094'),
  'latest-event readback authorizes monitoring after the later grant'
);
select is(
  (select count(*) from public.audit_log where action = 'consent.create' and client_id = '00000000-0000-4000-8000-000000004094'),
  4::bigint,
  'both original and both later grants remain in the consent audit trail'
);

select * from finish();
rollback;
