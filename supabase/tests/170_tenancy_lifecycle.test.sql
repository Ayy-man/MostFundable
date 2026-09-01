begin;

set local search_path = public, extensions;

select plan(36);

select has_column('public', 'orgs', 'trial_ends_at', 'orgs carries the trial end');
select has_column('public', 'orgs', 'brand_published_at', 'orgs carries the brand publication time');
select has_check('public', 'orgs', 'orgs carries the slug format check');
select has_trigger('public', 'orgs', 'orgs_tenancy_slug_guard', 'orgs carries the slug guard');
select is(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'tenancy_guard_org_slug'
  ),
  true,
  'the slug guard runs as its owner so granted org writers can invoke it'
);
select is(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'orgs'
  ),
  true,
  'orgs remains RLS-enabled and forced'
);
select is(
  has_function_privilege('authenticated', 'public.tenancy_expire_trials(date)', 'execute'),
  false,
  'authenticated callers cannot invoke trial expiry'
);
select is(
  has_function_privilege('service_role', 'public.tenancy_expire_trials(date)', 'execute'),
  true,
  'service role can invoke trial expiry'
);
select lives_ok(
  $$select public.enqueue_background_job('tenancy.trial_expiry', 'global', '2099-12-31')$$,
  'the shared job ledger accepts the tenancy expiry key'
);
select throws_ok(
  $$insert into public.background_jobs (job, subject, "window") values ('tenancy.unknown', 'global', '2099-12-31')$$,
  '23514', null, 'the job allow-list remains closed'
);

insert into auth.users (id, email)
values
  ('17000000-0000-4000-8000-000000000001', 'platform-admin@tenancy.test'),
  ('17000000-0000-4000-8000-000000000002', 'owner@tenancy.test'),
  ('17000000-0000-4000-8000-000000000003', 'consumer@tenancy.test');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values (
  '17000000-0000-4000-8000-000000000001',
  'platform_admin', null, null, 'Tenancy Admin', 'platform-admin@tenancy.test'
)
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

select throws_ok(
  $$insert into public.orgs (name, slug) values ('Bad Slug', 'Bad_slug')$$,
  '23514', null, 'mixed-case and underscore slugs fail'
);
select throws_ok(
  $$insert into public.orgs (name, slug) values ('Short Slug', 'ab')$$,
  '23514', null, 'slugs shorter than three characters fail'
);
select throws_ok(
  $$insert into public.orgs (name, slug) values ('Reserved Slug', 'admin')$$,
  '23514', 'TENANT_SLUG_RESERVED', 'the static reserved set fails'
);
select throws_ok(
  $$
    insert into public.orgs (name, slug)
    select 'Dynamic Reserved Slug', slug
    from public.orgs
    where brand @> '{"platform_intake": true}'::jsonb
    limit 1
  $$,
  '23514', 'TENANT_SLUG_RESERVED', 'the current platform intake slug fails'
);

insert into public.orgs (
  id, name, slug, membership, trial_ends_at, brand
)
values
  (
    '17000000-0000-4000-8000-000000000100', 'Lifecycle Org', 'lifecycle-org',
    'trial', pg_catalog.now() + interval '3 days',
    '{"fictional":true,"primaryColor":"#112233"}'::jsonb
  ),
  (
    '17000000-0000-4000-8000-000000000101', 'Expired Org', 'expired-org',
    'trial', pg_catalog.now() - interval '1 day', '{}'::jsonb
  ),
  (
    '17000000-0000-4000-8000-000000000102', 'Subscribed Org', 'subscribed-org',
    'trial', pg_catalog.now() - interval '1 day', '{}'::jsonb
  ),
  (
    '17000000-0000-4000-8000-000000000103', 'Lapsed Org', 'lapsed-org',
    'deactivated', pg_catalog.now() - interval '1 day', '{}'::jsonb
  );

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '17000000-0000-4000-8000-000000000002', 'operator_member',
    '17000000-0000-4000-8000-000000000100', 'owner',
    'Tenancy Owner', 'owner@tenancy.test'
  ),
  (
    '17000000-0000-4000-8000-000000000003', 'consumer',
    '17000000-0000-4000-8000-000000000101', null,
    'Tenancy Consumer', 'consumer@tenancy.test'
  )
on conflict (id) do update
set role = excluded.role,
    org_id = excluded.org_id,
    org_role = excluded.org_role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (
  id, org_id, consumer_profile_id, display_name
)
values (
  '17000000-0000-4000-8000-000000000200',
  '17000000-0000-4000-8000-000000000101',
  '17000000-0000-4000-8000-000000000003',
  'Tenancy Consumer Client'
);

insert into public.operator_subscriptions (
  org_id, provider, base_price_ref, seat_price_ref, status
)
values (
  '17000000-0000-4000-8000-000000000102',
  'mock', 'mock_base', 'mock_seat', 'active'
);

select lives_ok(
  $$select public.tenancy_publish_brand(
    '17000000-0000-4000-8000-000000000100',
    '17000000-0000-4000-8000-000000000002'
  )$$,
  'an owner can publish its claimed brand'
);
select isnt(
  (select brand_published_at from public.orgs where id = '17000000-0000-4000-8000-000000000100'),
  null::timestamptz,
  'publication persists a timestamp'
);
select throws_ok(
  $$update public.orgs set slug = 'direct-change' where id = '17000000-0000-4000-8000-000000000100'$$,
  '42501', 'TENANT_SLUG_PUBLISHED', 'a direct post-publish rename fails'
);
select throws_ok(
  $$select public.tenancy_rename_org_slug(
    '17000000-0000-4000-8000-000000000100', 'owner-change',
    '17000000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'TENANT_PLATFORM_ADMIN_REQUIRED', 'an org owner cannot use the rename bypass'
);
select lives_ok(
  $$select public.tenancy_rename_org_slug(
    '17000000-0000-4000-8000-000000000100', 'renamed-workspace',
    '17000000-0000-4000-8000-000000000001'
  )$$,
  'a platform admin can rename a published slug'
);
select is(
  (select slug from public.orgs where id = '17000000-0000-4000-8000-000000000100'),
  'renamed-workspace',
  'the authorized rename persists'
);
select is(
  (
    select (meta ->> 'from') || '->' || (meta ->> 'to')
    from public.audit_log
    where action = 'org.slug_renamed'
      and org_id = '17000000-0000-4000-8000-000000000100'
  ),
  'lifecycle-org->renamed-workspace',
  'the rename audit records the old and new slugs'
);

select lives_ok(
  $$select public.tenancy_apply_org_action(
    '17000000-0000-4000-8000-000000000100', 'deactivate', null,
    '17000000-0000-4000-8000-000000000001'
  )$$,
  'platform admin can deactivate an organization'
);
select is(
  (select membership::text from public.orgs where id = '17000000-0000-4000-8000-000000000100'),
  'deactivated',
  'deactivation persists the ladder rung'
);
select lives_ok(
  $$select public.tenancy_apply_org_action(
    '17000000-0000-4000-8000-000000000100', 'reactivate', null,
    '17000000-0000-4000-8000-000000000001'
  )$$,
  'a future trial can be reactivated'
);
select is(
  (select membership::text from public.orgs where id = '17000000-0000-4000-8000-000000000100'),
  'trial',
  'future-trial reactivation selects trial'
);
select throws_ok(
  $$select public.tenancy_apply_org_action(
    '17000000-0000-4000-8000-000000000103', 'reactivate', null,
    '17000000-0000-4000-8000-000000000001'
  )$$,
  '55000', 'TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION',
  'reactivation without a subscription or future trial fails closed'
);
select throws_ok(
  $$select public.tenancy_apply_org_action(
    '17000000-0000-4000-8000-000000000100', 'raise-cap', null,
    '17000000-0000-4000-8000-000000000001'
  )$$,
  '0A000', 'TENANT_ACTION_UNAVAILABLE', 'raise-cap remains a typed future action'
);

select is(
  (public.tenancy_expire_trials(current_date) ->> 'rows')::integer,
  1,
  'expiry deactivates exactly the unsubscribed due trial'
);
select is(
  (select membership::text from public.orgs where id = '17000000-0000-4000-8000-000000000101'),
  'deactivated',
  'the due unsubscribed org is deactivated'
);
select is(
  (select membership::text from public.orgs where id = '17000000-0000-4000-8000-000000000102'),
  'trial',
  'the active subscribed org remains trial'
);
select is(
  (
    select reason_code
    from public.operator_billing_events
    where org_id = '17000000-0000-4000-8000-000000000101'
  ),
  'trial_ended',
  'expiry records the billing reason'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where org_id = '17000000-0000-4000-8000-000000000101'
      and actor_profile_id is null
      and meta ->> 'reason_code' = 'trial_ended'
  ),
  1,
  'expiry records one system audit row'
);
select is(
  (public.tenancy_expire_trials(current_date) ->> 'rows')::integer,
  0,
  'expiry replay has no additional effect'
);
select is(
  (
    select count(*)::integer
    from public.operator_billing_events
    where org_id = '17000000-0000-4000-8000-000000000101'
      and event_id = 'tenancy.trial_expiry:' || current_date::text
  ),
  1,
  'the deterministic event key remains unique after replay'
);
select is(
  (
    select count(*)::integer
    from public.clients
    where id = '17000000-0000-4000-8000-000000000200'
      and consumer_profile_id = '17000000-0000-4000-8000-000000000003'
  ),
  1,
  'consumer and client state remains unchanged by expiry'
);
select is(
  (
    select count(*)::integer
    from public.audit_log
    where org_id = '17000000-0000-4000-8000-000000000100'
      and action = 'org.lifecycle_changed'
  ),
  2,
  'deactivate and reactivate each carry one lifecycle audit'
);

select * from finish();
rollback;
