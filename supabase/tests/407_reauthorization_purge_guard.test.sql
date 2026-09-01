begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000004071', 'reauthorization@test.example');
insert into public.orgs (id, name, slug)
values ('00000000-0000-4000-8000-000000004072', 'Reauthorization org', 'reauthorization-org');
insert into public.profiles (id, role, org_id, full_name, email)
values ('00000000-0000-4000-8000-000000004071', 'consumer', '00000000-0000-4000-8000-000000004072', 'Reauthorization Consumer', 'reauthorization@test.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = null, full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values ('00000000-0000-4000-8000-000000004073', '00000000-0000-4000-8000-000000004072', '00000000-0000-4000-8000-000000004071', 'Reauthorization Client');

insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref)
values
  (
    '00000000-0000-4000-8000-000000004074',
    '00000000-0000-4000-8000-000000004073',
    'analysis',
    'analysis-consent-v1',
    pg_catalog.now() - interval '40 days',
    '127.0.0.1',
    'reauthorization-agreement'
  ),
  (
    '00000000-0000-4000-8000-000000004079',
    '00000000-0000-4000-8000-000000004073',
    'monitoring',
    'monitoring-consent-v1',
    pg_catalog.now() - interval '40 days',
    '127.0.0.1',
    'reauthorization-agreement'
  );
insert into public.consent_revocations (id, consent_id, client_id, kind, revoked_at, revoked_by)
values (
  '00000000-0000-4000-8000-000000004075',
  '00000000-0000-4000-8000-000000004074',
  '00000000-0000-4000-8000-000000004073',
  'analysis',
  pg_catalog.now() - interval '31 days',
  '00000000-0000-4000-8000-000000004071'
);
insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref)
values (
  '00000000-0000-4000-8000-000000004076',
  '00000000-0000-4000-8000-000000004073',
  'analysis',
  'analysis-consent-v1',
  pg_catalog.now() - interval '1 day',
  '127.0.0.1',
  'reauthorization-new-grant'
);
insert into public.enrollments (
  id, client_id, crs_member_ref, status, esig_doc_id,
  monitoring_consent_at, analysis_consent_at
) values (
  '00000000-0000-4000-8000-000000004077',
  '00000000-0000-4000-8000-000000004073',
  'mock_reauthorization',
  'active',
  'reauthorization-agreement',
  pg_catalog.now() - interval '40 days',
  pg_catalog.now() - interval '40 days'
);
insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, subscription_ref,
  price_cents, status, idempotency_key
) values (
  '00000000-0000-4000-8000-000000004078',
  '00000000-0000-4000-8000-000000004073',
  '00000000-0000-4000-8000-000000004077',
  'mock',
  'mock_reauthorization_customer',
  'mock_reauthorization_subscription',
  1900,
  'active',
  'reauthorization-active-subscription'
);

select ok(
  public.analysis_is_authorized('00000000-0000-4000-8000-000000004073'),
  'the later signed grant restores current analysis authorization'
);
select is(
  (
    select count(*)
    from public.list_derived_purge_targets(pg_catalog.now() + interval '1 day')
    where enrollment_id = '00000000-0000-4000-8000-000000004077'
  ),
  0::bigint,
  'the historical due revocation is no longer rediscovered'
);
select is(
  public.purge_derived_enrollment(
    '00000000-0000-4000-8000-000000004077',
    'mock_reauthorization'
  ),
  0,
  'an already queued historical purge becomes a safe no-op'
);
select is(
  (
    select crs_member_ref
    from public.enrollments
    where id = '00000000-0000-4000-8000-000000004077'
  ),
  'mock_reauthorization',
  'the no-op keeps the active provider routing handle intact'
);

select * from finish();
rollback;
