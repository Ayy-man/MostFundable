begin;

-- Deterministic fictional identity map. These UUIDs are stable row identifiers only.
-- Organizations: a000...001 = Northbridge, b000...001 = Cedar Harbor,
-- f000...001 = MostFundable PLATFORM intake.
-- Profiles: 0000...001 = platform admin; a100... = Org A; b100... = Org B.
-- Affiliate: a200...001 = Org A affiliate.
-- Support and assistant: c100...00N = team-chat threads, c200... = held drafts,
-- c300... = assistant conversations, c400... = assistant turns.

-- Local-only Auth accounts. The fixed password below is test data for this local
-- stack, and the matching FEES_E2E_* names are documented in web/.env.example.
with local_auth as (
  select
    extensions.crypt('mf-local-seed-only', extensions.gen_salt('bf')) as password_hash,
    now() as seeded_at
), seeded_users (id, email) as (
  values
    ('00000000-0000-0000-0000-000000000001'::uuid, 'admin@platform.example'),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'owner@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 'prep@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000003'::uuid, 'affiliate@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000011'::uuid, 'clean@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000012'::uuid, 'derog@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000013'::uuid, 'thin-file@northbridge.example'),
    ('a1000000-0000-0000-0000-000000000014'::uuid, 'newcomer@northbridge.example'),
    ('b1000000-0000-0000-0000-000000000001'::uuid, 'owner@cedar-harbor.example'),
    ('b1000000-0000-0000-0000-000000000011'::uuid, 'consumer@cedar-harbor.example')
)
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
select
  seeded_users.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  seeded_users.email,
  local_auth.password_hash,
  local_auth.seeded_at,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  case
    when seeded_users.id in (
      'a1000000-0000-0000-0000-000000000011'::uuid,
      'a1000000-0000-0000-0000-000000000012'::uuid,
      'a1000000-0000-0000-0000-000000000013'::uuid,
      'a1000000-0000-0000-0000-000000000014'::uuid,
      'b1000000-0000-0000-0000-000000000011'::uuid
    ) then '{"provider":"email","providers":["email"],"paid_refresh_mock_history":true}'::jsonb
    else '{"provider":"email","providers":["email"]}'::jsonb
  end,
  '{}'::jsonb,
  false,
  false,
  false,
  local_auth.seeded_at,
  local_auth.seeded_at
from seeded_users
cross join local_auth
on conflict (id) do update
set
  instance_id = excluded.instance_id,
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  confirmation_token = excluded.confirmation_token,
  recovery_token = excluded.recovery_token,
  email_change_token_new = excluded.email_change_token_new,
  email_change = excluded.email_change,
  email_change_token_current = excluded.email_change_token_current,
  phone_change = excluded.phone_change,
  phone_change_token = excluded.phone_change_token,
  reauthentication_token = excluded.reauthentication_token,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  is_super_admin = excluded.is_super_admin,
  is_sso_user = excluded.is_sso_user,
  is_anonymous = excluded.is_anonymous,
  updated_at = excluded.updated_at;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  seeded.email,
  seeded.id,
  jsonb_build_object('sub', seeded.id::text, 'email', seeded.email),
  'email',
  now(),
  now(),
  now()
from auth.users as seeded
where seeded.id in (
  '00000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000011',
  'a1000000-0000-0000-0000-000000000012',
  'a1000000-0000-0000-0000-000000000013',
  'a1000000-0000-0000-0000-000000000014',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000011'
)
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  last_sign_in_at = excluded.last_sign_in_at,
  updated_at = excluded.updated_at;

-- Fictional operator organizations.
insert into public.orgs (
  id,
  name,
  slug,
  brand,
  plan,
  seats_included,
  seat_price_cents,
  base_price_cents,
  membership,
  monitoring_split_pct,
  default_client_goal_cents,
  team_sees_all_clients,
  assignment_mode
)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    'Northbridge Funding Group',
    'northbridge-fictional',
    '{"fictional": true, "support_email": "support@northbridge.example"}'::jsonb,
    'agency',
    5,
    2900,
    49700,
    'current',
    20,
    10000000,
    true,
    'manual'
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    'Cedar Harbor Fictional Cooperative',
    'cedar-harbor-fictional',
    '{"fictional": true, "support_email": "support@cedar-harbor.example"}'::jsonb,
    'trial',
    3,
    2900,
    49700,
    'trial',
    null,
    7500000,
    true,
    'manual'
  ),
  (
    'f0000000-0000-0000-0000-000000000001',
    'MostFundable Fictional Intake',
    'mostfundable-platform-intake',
    '{"fictional": true, "platform_intake": true}'::jsonb,
    'trial',
    0,
    2900,
    49700,
    'trial',
    null,
    10000000,
    true,
    'manual'
  )
on conflict (id) do update
set
  name = excluded.name,
  slug = excluded.slug,
  brand = excluded.brand,
  plan = excluded.plan,
  seats_included = excluded.seats_included,
  seat_price_cents = excluded.seat_price_cents,
  base_price_cents = excluded.base_price_cents,
  membership = excluded.membership,
  monitoring_split_pct = excluded.monitoring_split_pct,
  default_client_goal_cents = excluded.default_client_goal_cents,
  team_sees_all_clients = excluded.team_sees_all_clients,
  assignment_mode = excluded.assignment_mode;

-- Application identities with role shapes enforced by the schema.
insert into public.profiles (
  id,
  role,
  org_id,
  org_role,
  manages,
  full_name,
  email,
  phone
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'platform_admin',
    null,
    null,
    '{}'::uuid[],
    'Parker Platform Demo',
    'admin@platform.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    'operator_member',
    'a0000000-0000-0000-0000-000000000001',
    'owner',
    '{}'::uuid[],
    'Avery Northbridge Demo',
    'owner@northbridge.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000002',
    'operator_member',
    'a0000000-0000-0000-0000-000000000001',
    'prep_specialist',
    '{}'::uuid[],
    'Priya Northbridge Demo',
    'prep@northbridge.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'affiliate',
    'a0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Alex Affiliate Demo',
    'affiliate@northbridge.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000011',
    'consumer',
    'a0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Casey Clean Demo',
    'clean@northbridge.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000012',
    'consumer',
    'a0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Devon Derog Demo',
    'derog@northbridge.example',
    null
  ),
  (
    'a1000000-0000-0000-0000-000000000013',
    'consumer',
    'a0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Taylor Thin File Demo',
    'thin-file@northbridge.example',
    null
  ),
  -- The demo shell's Consumer slot (web/src/lib/demo/demo-session.ts). Deliberately NOT enrolled:
  -- no consents, e-signature, enrollment, analysis run or plan are seeded for this person, so the
  -- Milestone-2 enrollment beat can run cold after `demo:reset` (enrollments.client_id is unique, so
  -- an already-enrolled consumer answers 409 to POST /api/enroll). Their credit persona is minted by
  -- the mock identity step at enrollment time; nothing about them exists before consent.
  (
    'a1000000-0000-0000-0000-000000000014',
    'consumer',
    'a0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Jordan Newcomer Demo',
    'newcomer@northbridge.example',
    null
  ),
  (
    'b1000000-0000-0000-0000-000000000001',
    'operator_member',
    'b0000000-0000-0000-0000-000000000001',
    'owner',
    '{}'::uuid[],
    'Blair Cedar Demo',
    'owner@cedar-harbor.example',
    null
  ),
  (
    'b1000000-0000-0000-0000-000000000011',
    'consumer',
    'b0000000-0000-0000-0000-000000000001',
    null,
    '{}'::uuid[],
    'Cameron Cedar Demo',
    'consumer@cedar-harbor.example',
    null
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  manages = excluded.manages,
  full_name = excluded.full_name,
  email = excluded.email,
  phone = excluded.phone;

-- The single Org A affiliate identity and referral record.
insert into public.affiliates (
  id,
  org_id,
  profile_id,
  name,
  referral_slug
)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000003',
  'Northbridge Fictional Partner',
  'northbridge-fictional-partner'
)
on conflict (id) do update
set
  org_id = excluded.org_id,
  profile_id = excluded.profile_id,
  name = excluded.name,
  referral_slug = excluded.referral_slug;

-- Consumer-linked clients. Client UUIDs use a300... and preserve one foreign-org control.
do $seed_clients$
declare
  v_previous_marker text := current_setting('app.governed_client_write', true);
begin
perform pg_catalog.set_config('app.governed_client_write', 'on', true);

insert into public.clients (
  id,
  org_id,
  consumer_profile_id,
  business_name,
  display_name,
  stage,
  assigned_to,
  affiliate_id,
  goal_cents,
  started_at,
  stage_entered_at,
  matches_unlocked_override,
  funded_amount_cents
)
values
  (
    'a3000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000011',
    'Clear Path Fictional Studio',
    'Casey Clean Demo',
    'onboarding',
    'a1000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    10000000,
    '2026-08-01',
    '2026-08-01T09:00:00Z',
    false,
    0
  ),
  (
    'a3000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000012',
    'Lighthouse Ledger Fictional Works',
    'Devon Derog Demo',
    'onboarding',
    'a1000000-0000-0000-0000-000000000002',
    null,
    12500000,
    '2026-08-01',
    '2026-08-01T09:01:00Z',
    false,
    0
  ),
  (
    'a3000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000013',
    'New Leaf Fictional Design',
    'Taylor Thin File Demo',
    'onboarding',
    'a1000000-0000-0000-0000-000000000001',
    null,
    8000000,
    '2026-08-01',
    '2026-08-01T09:02:00Z',
    false,
    0
  ),
  -- Operator-side lead record for the demo shell's consumer: Onboarding, never transitioned, no
  -- enrollment. Its stage moves to Optimization with a live `stage_entered_at` when the enrollment
  -- beat activates (the timestamp the operator tracker beat then shows).
  (
    'a3000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000014',
    'Harbor Lane Fictional Bakery',
    'Jordan Newcomer Demo',
    'onboarding',
    'a1000000-0000-0000-0000-000000000001',
    null,
    6000000,
    '2026-08-01',
    '2026-08-01T09:04:00Z',
    false,
    0
  ),
  (
    'b3000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000011',
    'Cedar Sample Fictional Workshop',
    'Cameron Cedar Demo',
    'onboarding',
    'b1000000-0000-0000-0000-000000000001',
    null,
    7500000,
    '2026-08-01',
    '2026-08-01T09:03:00Z',
    false,
    0
  )
on conflict (id) do update
set
  org_id = excluded.org_id,
  consumer_profile_id = excluded.consumer_profile_id,
  business_name = excluded.business_name,
  display_name = excluded.display_name,
  assigned_to = excluded.assigned_to,
  affiliate_id = excluded.affiliate_id,
  goal_cents = excluded.goal_cents,
  started_at = excluded.started_at,
  matches_unlocked_override = excluded.matches_unlocked_override,
  funded_amount_cents = excluded.funded_amount_cents;

perform pg_catalog.set_config(
  'app.governed_client_write', coalesce(v_previous_marker, ''), true
);
end
$seed_clients$;

-- Consent grants precede enrollment creation for every seeded consumer.
insert into public.consents (
  id,
  client_id,
  kind,
  action,
  text_version,
  signed_at,
  ip,
  esig_ref,
  created_at
)
values
  (
    'a4000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'monitoring',
    'granted',
    'monitoring-v1-fictional',
    '2026-08-01T10:00:00Z',
    '192.0.2.11',
    'esig-fictional-a-clean',
    '2026-08-01T10:00:00Z'
  ),
  (
    'a4000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000001',
    'analysis',
    'granted',
    'analysis-v1-fictional',
    '2026-08-01T10:01:00Z',
    '192.0.2.11',
    'esig-fictional-a-clean',
    '2026-08-01T10:01:00Z'
  ),
  (
    'a4000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000002',
    'monitoring',
    'granted',
    'monitoring-v1-fictional',
    '2026-08-01T11:00:00Z',
    '192.0.2.12',
    'esig-fictional-a-derog',
    '2026-08-01T11:00:00Z'
  ),
  (
    'a4000000-0000-0000-0000-000000000004',
    'a3000000-0000-0000-0000-000000000002',
    'analysis',
    'granted',
    'analysis-v1-fictional',
    '2026-08-01T11:01:00Z',
    '192.0.2.12',
    'esig-fictional-a-derog',
    '2026-08-01T11:01:00Z'
  ),
  (
    'a4000000-0000-0000-0000-000000000005',
    'a3000000-0000-0000-0000-000000000003',
    'monitoring',
    'granted',
    'monitoring-v1-fictional',
    '2026-08-01T12:00:00Z',
    '192.0.2.13',
    'esig-fictional-a-thin',
    '2026-08-01T12:00:00Z'
  ),
  (
    'a4000000-0000-0000-0000-000000000006',
    'a3000000-0000-0000-0000-000000000003',
    'analysis',
    'granted',
    'analysis-v1-fictional',
    '2026-08-01T12:01:00Z',
    '192.0.2.13',
    'esig-fictional-a-thin',
    '2026-08-01T12:01:00Z'
  ),
  (
    'b4000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'monitoring',
    'granted',
    'monitoring-v1-fictional',
    '2026-08-01T13:00:00Z',
    '192.0.2.21',
    'esig-fictional-b-control',
    '2026-08-01T13:00:00Z'
  ),
  (
    'b4000000-0000-0000-0000-000000000002',
    'b3000000-0000-0000-0000-000000000001',
    'analysis',
    'granted',
    'analysis-v1-fictional',
    '2026-08-01T13:01:00Z',
    '192.0.2.21',
    'esig-fictional-b-control',
    '2026-08-01T13:01:00Z'
  )
on conflict (id) do nothing;

-- Demo enrollments use the exact frozen persona values. The three Northbridge personas with
-- persisted analysis and plan surfaces are activated; the Cedar control remains enrolled because
-- it has no member reference or derived surface, and the newcomer remains un-enrolled below.
--
-- `crs_member_ref` carries a mock-driver-shaped reference rather than null, because the analysis
-- worker resolves its source file from this column alone: a null ref fails the run with
-- `source_unavailable` before any adapter is asked, so a seeded persona could never be analysed.
-- The mock driver decodes the persona out of the ref itself (`mock_<persona>_<sequence>`) and has
-- no registry, so a ref written here pulls the matching file in a process the driver never minted
-- it in. Each ref's persona must equal the row's `persona_hint`, and the column is unique, so a
-- new fixture takes a new sequence number. Cedar Harbor's control row stays null on purpose: it
-- has no persona and must keep failing closed if anything ever tries to analyse it.
insert into public.enrollments (
  id,
  client_id,
  crs_member_ref,
  status,
  monitoring_consent_at,
  analysis_consent_at,
  esig_doc_id,
  idpass,
  parked_until,
  persona_hint,
  created_at,
  updated_at
)
values
  (
    'a5000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'mock_clean_000001',
    'active',
    '2026-08-01T10:00:00Z',
    '2026-08-01T10:01:00Z',
    'esig-fictional-a-clean',
    false,
    null,
    'clean',
    '2026-08-01T10:05:00Z',
    '2026-08-01T10:05:00Z'
  ),
  (
    'a5000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000002',
    'mock_derog_000002',
    'active',
    '2026-08-01T11:00:00Z',
    '2026-08-01T11:01:00Z',
    'esig-fictional-a-derog',
    false,
    null,
    'derog',
    '2026-08-01T11:05:00Z',
    '2026-08-01T11:05:00Z'
  ),
  (
    'a5000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'mock_thin_file_000003',
    'active',
    '2026-08-01T12:00:00Z',
    '2026-08-01T12:01:00Z',
    'esig-fictional-a-thin',
    false,
    null,
    'thin_file',
    '2026-08-01T12:05:00Z',
    '2026-08-01T12:05:00Z'
  ),
  (
    'b5000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    null,
    'enrolled',
    '2026-08-01T13:00:00Z',
    '2026-08-01T13:01:00Z',
    'esig-fictional-b-control',
    false,
    null,
    null,
    '2026-08-01T13:05:00Z',
    '2026-08-01T13:05:00Z'
  )
on conflict (id) do update
set
  client_id = excluded.client_id,
  crs_member_ref = excluded.crs_member_ref,
  status = excluded.status,
  monitoring_consent_at = excluded.monitoring_consent_at,
  analysis_consent_at = excluded.analysis_consent_at,
  esig_doc_id = excluded.esig_doc_id,
  idpass = excluded.idpass,
  parked_until = excluded.parked_until,
  persona_hint = excluded.persona_hint,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

-- R5A-03. The passed identity session each activated persona must hold. Migration 355 refuses
-- settlement unless the same enrollment carries a locked `idv_sessions` row in `state='passed'`,
-- so before this block the three settled demo subscriptions were state the product's own authority
-- could no longer have produced: a clean reset read `active | idpass=false | subscription active |
-- idv_rows=0` for all three. The seed's job is to contain only what the current authority can
-- produce, not to make a query look right.
--
-- Shape matches what `enrollment_idv_started` then `enrollment_idv_settled` actually write for a
-- first-time member who passes on the SMS step: `driver='mock'`, `kind='sms'`, `state='passed'`,
-- `outcome='pass'`, `attempts_used=0` (the settled pair only increments on retry and lock),
-- `member_ref` equal to the enrollment's own `crs_member_ref`, and no lock window. `idpass` stays
-- false on the enrollment because it is CRS's returning-member flag, read from a `createMember`
-- response and never written by the IDV settlement — false is exactly what a first-time pass leaves
-- behind. Cameron's Cedar control keeps no session, because it never enrolled.
--
-- Timestamps sit between the enrollment row and the subscription activation, which is the real
-- order: identity is settled before the charge. The aa21 prefix identifies migration 021's identity
-- entity within the deterministic seed id map.
insert into public.idv_sessions (
  id,
  enrollment_id,
  client_id,
  member_ref,
  driver,
  kind,
  state,
  attempts_used,
  max_attempts,
  outcome,
  created_at,
  updated_at
)
values
  (
    'aa210000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'mock_clean_000001',
    'mock',
    'sms',
    'passed',
    0,
    3,
    'pass',
    '2026-08-01T10:04:00Z',
    '2026-08-01T10:04:30Z'
  ),
  (
    'aa210000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000002',
    'mock_derog_000002',
    'mock',
    'sms',
    'passed',
    0,
    3,
    'pass',
    '2026-08-01T11:04:00Z',
    '2026-08-01T11:04:30Z'
  ),
  (
    'aa210000-0000-0000-0000-000000000003',
    'a5000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'mock_thin_file_000003',
    'mock',
    'sms',
    'passed',
    0,
    3,
    'pass',
    '2026-08-01T12:04:00Z',
    '2026-08-01T12:04:30Z'
  )
on conflict (id) do update
set
  enrollment_id = excluded.enrollment_id,
  client_id = excluded.client_id,
  member_ref = excluded.member_ref,
  driver = excluded.driver,
  kind = excluded.kind,
  state = excluded.state,
  attempts_used = excluded.attempts_used,
  max_attempts = excluded.max_attempts,
  outcome = excluded.outcome,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

-- The activated demo personas carry the same settled mock subscription shape produced by the
-- enrollment service. Consent and enrollment rows precede these rows, and activation timestamps
-- precede every persisted analysis projection. The aa22 prefix identifies migration 022's billing
-- entity within the deterministic seed id map.
insert into public.consumer_subscriptions (
  id,
  client_id,
  enrollment_id,
  provider,
  customer_ref,
  setup_intent_ref,
  payment_method_ref,
  subscription_ref,
  price_ref,
  price_cents,
  currency,
  status,
  idempotency_key,
  subscription_attempt_at,
  activated_at,
  created_at,
  updated_at,
  operation_id,
  operation_state,
  operation_started_at,
  attempt_provider_subscription_ref,
  attempt_provider_amount_cents,
  attempt_provider_currency,
  attempt_provider_status,
  attempt_provider_returned_at
)
values
  (
    'aa220000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000001',
    'mock',
    'mock_customer_seed_clean',
    'mock_seti_seed_clean',
    'mock_pm_seed_clean',
    'mock_subscription_seed_clean',
    'mock_price_monitoring',
    4900,
    'usd',
    'active',
    'enroll:a5000000-0000-0000-0000-000000000001:sub',
    '2026-08-01T10:05:30Z',
    '2026-08-01T10:06:00Z',
    '2026-08-01T10:05:30Z',
    '2026-08-01T10:06:00Z',
    'enroll:a5000000-0000-0000-0000-000000000001:sub',
    'settled',
    '2026-08-01T10:05:30Z',
    'mock_subscription_seed_clean',
    4900,
    'usd',
    'active',
    '2026-08-01T10:05:59Z'
  ),
  (
    'aa220000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000002',
    'mock',
    'mock_customer_seed_derog',
    'mock_seti_seed_derog',
    'mock_pm_seed_derog',
    'mock_subscription_seed_derog',
    'mock_price_monitoring',
    4900,
    'usd',
    'active',
    'enroll:a5000000-0000-0000-0000-000000000002:sub',
    '2026-08-01T11:05:30Z',
    '2026-08-01T11:06:00Z',
    '2026-08-01T11:05:30Z',
    '2026-08-01T11:06:00Z',
    'enroll:a5000000-0000-0000-0000-000000000002:sub',
    'settled',
    '2026-08-01T11:05:30Z',
    'mock_subscription_seed_derog',
    4900,
    'usd',
    'active',
    '2026-08-01T11:05:59Z'
  ),
  (
    'aa220000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'a5000000-0000-0000-0000-000000000003',
    'mock',
    'mock_customer_seed_thin_file',
    'mock_seti_seed_thin_file',
    'mock_pm_seed_thin_file',
    'mock_subscription_seed_thin_file',
    'mock_price_monitoring',
    4900,
    'usd',
    'active',
    'enroll:a5000000-0000-0000-0000-000000000003:sub',
    '2026-08-01T12:05:30Z',
    '2026-08-01T12:06:00Z',
    '2026-08-01T12:05:30Z',
    '2026-08-01T12:06:00Z',
    'enroll:a5000000-0000-0000-0000-000000000003:sub',
    'settled',
    '2026-08-01T12:05:30Z',
    'mock_subscription_seed_thin_file',
    4900,
    'usd',
    'active',
    '2026-08-01T12:05:59Z'
  )
on conflict (id) do update
set
  client_id = excluded.client_id,
  enrollment_id = excluded.enrollment_id,
  provider = excluded.provider,
  customer_ref = excluded.customer_ref,
  setup_intent_ref = excluded.setup_intent_ref,
  payment_method_ref = excluded.payment_method_ref,
  subscription_ref = excluded.subscription_ref,
  price_ref = excluded.price_ref,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  status = excluded.status,
  idempotency_key = excluded.idempotency_key,
  subscription_attempt_at = excluded.subscription_attempt_at,
  activated_at = excluded.activated_at,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  operation_id = excluded.operation_id,
  operation_state = excluded.operation_state,
  operation_started_at = excluded.operation_started_at,
  attempt_provider_subscription_ref = excluded.attempt_provider_subscription_ref,
  attempt_provider_amount_cents = excluded.attempt_provider_amount_cents,
  attempt_provider_currency = excluded.attempt_provider_currency,
  attempt_provider_status = excluded.attempt_provider_status,
  attempt_provider_returned_at = excluded.attempt_provider_returned_at;

-- One same-org affiliate projection with a typed initial state.
insert into public.affiliate_client_shares (
  affiliate_id,
  client_id,
  expected_commission_cents,
  payment_status
)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  12500,
  'not_ready'
)
on conflict (affiliate_id, client_id) do update
set
  expected_commission_cents = excluded.expected_commission_cents,
  payment_status = excluded.payment_status;

-- Tracker timer origins enter through the same serialized boundary used by live
-- enrollment and analysis events. Stable receipt keys make every rerun a no-op.
do $$
begin
  perform *
  from public.tracker_transition_client_stage(
    'a3000000-0000-0000-0000-000000000001',
    'optimization',
    'onboarding',
    null,
    'seed',
    'seed:tracker:clean:optimization'
  );

  perform *
  from public.tracker_transition_client_stage(
    'a3000000-0000-0000-0000-000000000002',
    'optimization',
    'onboarding',
    null,
    'seed',
    'seed:tracker:derog:optimization'
  );

  perform *
  from public.tracker_transition_client_stage(
    'a3000000-0000-0000-0000-000000000003',
    'applying',
    'onboarding',
    null,
    'seed',
    'seed:tracker:thin-file:applying'
  );
end;
$$;

-- Explicit derived tracker inputs. No provider content or recorded outcome is
-- stored: the enabled read model projects only the numeric readiness and run time.
insert into public.analysis_runs (
  id,
  client_id,
  ran_at,
  trigger,
  readiness_score,
  derived
)
values
  (
    'a6000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    '2026-08-15T09:00:00Z',
    'scheduled',
    92,
    '{
      "accounts": [],
      "averageAgeMonths": 48,
      "bureausPulled": ["EQF", "EXP", "TUC"],
      "computedAt": "2026-08-15T09:00:00Z",
      "dti": {
        "monthlyDebtPaymentsCents": 120000,
        "ratioPct": 24,
        "statedMonthlyIncomeCents": 500000
      },
      "flags": {
        "averageAgeTwoYearsOrMore": true,
        "cardWithTenKLimit": true,
        "fourOrMorePersonalAccountsOpen": true,
        "noNegativeItemsReported": true,
        "thinFile": false,
        "twoOrFewerInquiriesEveryBureau": true,
        "utilizationUnder30": true
      },
      "highestRevolvingLimitCents": 1250000,
      "inquiriesByBureau": {"EQF": 1, "EXP": 1, "TUC": 0},
      "negativesCount": 0,
      "openRevolvingCount": 4,
      "overallUtilizationPct": 18,
      "schemaVersion": 1
    }'::jsonb
  ),
  (
    'a6000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000002',
    '2026-08-15T09:05:00Z',
    'scheduled',
    58,
    '{
      "accounts": [],
      "averageAgeMonths": 20,
      "bureausPulled": ["EQF", "EXP", "TUC"],
      "computedAt": "2026-08-15T09:05:00Z",
      "dti": {
        "monthlyDebtPaymentsCents": 180000,
        "ratioPct": 45,
        "statedMonthlyIncomeCents": 400000
      },
      "flags": {
        "averageAgeTwoYearsOrMore": false,
        "cardWithTenKLimit": false,
        "fourOrMorePersonalAccountsOpen": true,
        "noNegativeItemsReported": false,
        "thinFile": false,
        "twoOrFewerInquiriesEveryBureau": false,
        "utilizationUnder30": false
      },
      "highestRevolvingLimitCents": 600000,
      "inquiriesByBureau": {"EQF": 3, "EXP": 2, "TUC": 4},
      "negativesCount": 2,
      "openRevolvingCount": 4,
      "overallUtilizationPct": 62,
      "schemaVersion": 1
    }'::jsonb
  ),
  (
    'a6000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    '2026-08-15T09:10:00Z',
    'scheduled',
    64,
    '{
      "accounts": [],
      "averageAgeMonths": 10,
      "bureausPulled": ["EQF", "EXP", "TUC"],
      "computedAt": "2026-08-15T09:10:00Z",
      "dti": {
        "monthlyDebtPaymentsCents": 90000,
        "ratioPct": 30,
        "statedMonthlyIncomeCents": 300000
      },
      "flags": {
        "averageAgeTwoYearsOrMore": false,
        "cardWithTenKLimit": false,
        "fourOrMorePersonalAccountsOpen": false,
        "noNegativeItemsReported": true,
        "thinFile": true,
        "twoOrFewerInquiriesEveryBureau": true,
        "utilizationUnder30": true
      },
      "highestRevolvingLimitCents": 350000,
      "inquiriesByBureau": {"EQF": 0, "EXP": 1, "TUC": 0},
      "negativesCount": 0,
      "openRevolvingCount": 2,
      "overallUtilizationPct": 12,
      "schemaVersion": 1
    }'::jsonb
  )
on conflict (id) do update
set
  client_id = excluded.client_id,
  ran_at = excluded.ran_at,
  trigger = excluded.trigger,
  readiness_score = excluded.readiness_score,
  derived = excluded.derived;

insert into public.plans (
  id,
  client_id,
  analysis_run_id,
  version,
  body,
  readiness_score,
  created_at
)
values
  (
    'a7000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a6000000-0000-0000-0000-000000000001',
    1,
    '{"summary":"Persisted funding readiness plan"}'::jsonb,
    92,
    '2026-08-15T09:01:00Z'
  ),
  (
    'a7000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000002',
    'a6000000-0000-0000-0000-000000000002',
    1,
    '{"summary":"Persisted funding readiness plan"}'::jsonb,
    58,
    '2026-08-15T09:06:00Z'
  ),
  (
    'a7000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'a6000000-0000-0000-0000-000000000003',
    1,
    '{"summary":"Persisted funding readiness plan"}'::jsonb,
    64,
    '2026-08-15T09:11:00Z'
  )
on conflict (id) do update
set
  client_id = excluded.client_id,
  analysis_run_id = excluded.analysis_run_id,
  version = excluded.version,
  body = excluded.body,
  readiness_score = excluded.readiness_score,
  created_at = excluded.created_at;

insert into public.checklist_templates (
  id,
  kind,
  key,
  title,
  blocking,
  sort_order
)
values
  (
    'a8000000-0000-0000-0000-000000000001',
    'personal_credit',
    'utilization-under-thirty',
    'Utilization under 30% readiness',
    true,
    10
  ),
  (
    'a8000000-0000-0000-0000-000000000002',
    'business_setup',
    'business-profile-complete',
    'Business profile readiness complete',
    true,
    20
  )
on conflict (id) do update
set
  kind = excluded.kind,
  key = excluded.key,
  title = excluded.title,
  blocking = excluded.blocking,
  sort_order = excluded.sort_order;

insert into public.checklist_items (
  id,
  client_id,
  template_id,
  title,
  blocking,
  sort_order,
  created_at
)
values
  (
    'a9000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000001',
    'Utilization under 30% verified',
    true,
    10,
    '2026-08-15T09:02:00Z'
  ),
  (
    'a9000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000002',
    'Business profile readiness pending',
    true,
    20,
    '2026-08-15T09:02:00Z'
  ),
  (
    'a9000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'a8000000-0000-0000-0000-000000000001',
    'Utilization readiness pending',
    true,
    10,
    '2026-08-15T09:12:00Z'
  ),
  -- The derogatory-file persona carries both durable checklist rows so the consumer
  -- Optimization read has something to overlay: one factor mid-flight, one untouched.
  (
    'a9000000-0000-0000-0000-000000000008',
    'a3000000-0000-0000-0000-000000000002',
    'a8000000-0000-0000-0000-000000000001',
    'Utilization under 30% readiness pending',
    true,
    10,
    '2026-08-15T09:07:00Z'
  ),
  (
    'a9000000-0000-0000-0000-000000000009',
    'a3000000-0000-0000-0000-000000000002',
    'a8000000-0000-0000-0000-000000000002',
    'Business profile readiness pending',
    true,
    20,
    '2026-08-15T09:07:00Z'
  )
on conflict (id) do update
set
  client_id = excluded.client_id,
  template_id = excluded.template_id,
  title = excluded.title,
  blocking = excluded.blocking,
  sort_order = excluded.sort_order,
  created_at = excluded.created_at;

-- One deterministic fictional operator-to-operator referral. The percentage,
-- term, and basis are deliberately omitted so migration 110 owns the defaults.
insert into public.saas_referrals (
  id,
  referrer_org_id,
  referred_org_id,
  started_at
)
values (
  'aa140000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  '2026-08-01'
)
on conflict (id) do update
set
  referrer_org_id = excluded.referrer_org_id,
  referred_org_id = excluded.referred_org_id,
  started_at = excluded.started_at;

insert into public.checklist_item_state (
  checklist_item_id,
  client_id,
  state,
  reported_at,
  verifying_at,
  verified_at,
  verified_by_run_id
)
values
  (
    'a9000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'verified',
    '2026-08-15T09:03:00Z',
    '2026-08-15T09:04:00Z',
    '2026-08-15T09:05:00Z',
    'a6000000-0000-0000-0000-000000000001'
  ),
  (
    'a9000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-000000000001',
    'todo',
    null,
    null,
    null,
    null
  ),
  (
    'a9000000-0000-0000-0000-000000000003',
    'a3000000-0000-0000-0000-000000000003',
    'todo',
    null,
    null,
    null,
    null
  ),
  -- 'reported' is the state the consumer Optimization view renders as "checking": the
  -- consumer has told us something and no analysis run has re-derived the factor yet.
  -- The shape check on this table requires reported_at set and the later stamps null.
  (
    'a9000000-0000-0000-0000-000000000008',
    'a3000000-0000-0000-0000-000000000002',
    'reported',
    '2026-08-16T10:15:00Z',
    null,
    null,
    null
  ),
  (
    'a9000000-0000-0000-0000-000000000009',
    'a3000000-0000-0000-0000-000000000002',
    'todo',
    null,
    null,
    null,
    null
  )
on conflict (checklist_item_id) do update
set
  client_id = excluded.client_id,
  state = excluded.state,
  reported_at = excluded.reported_at,
  verifying_at = excluded.verifying_at,
  verified_at = excluded.verified_at,
  verified_by_run_id = excluded.verified_by_run_id;

-- ---------------------------------------------------------------------------
-- Support threads, the messages in them, held drafts, and read watermarks.
-- ---------------------------------------------------------------------------
--
-- Every message here is inserted by public.support_send_message and by nothing
-- else. The seed runs as the table owner and could write the rows directly,
-- which is exactly why it must not: migration 100's claim is that one function
-- is the only writer, and a seed that reached around it would be the first
-- counter-example. Going through the RPC also means the seeded rows are subject
-- to every refusal a live send is subject to, so a thread whose participants do
-- not line up fails the seed instead of shipping as data nobody can reproduce.
--
-- The RPC stamps sent_at with now(), correctly: a message's time is when it was
-- sent, and letting a caller choose it would make the audit trail worth less
-- than nothing. The seed then back-dates the row it just created, so a demo
-- thread reads as a conversation over an afternoon rather than five messages in
-- the same millisecond, whose order is not even deterministic. That update is
-- the table owner's, it happens nowhere else, and it changes no other column.
--
-- Nothing here implies data collected before consent or a charge before
-- enrollment. Jordan Newcomer Demo, the un-enrolled Milestone-2 slot, has a
-- thread with one outbound message and no reply: an operator saying hello costs
-- the consumer nothing and creates nothing.
--
-- c1 = threads, c2 = held drafts, c3 = assistant conversations, c4 = turns.

insert into public.support_threads (
  id,
  kind,
  org_id,
  client_id,
  status,
  subject,
  created_by,
  created_at,
  last_activity_at
)
values
  (
    'c1000000-0000-0000-0000-000000000001',
    'team_chat',
    'a0000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'open',
    'Welcome and first steps',
    'a1000000-0000-0000-0000-000000000002',
    '2026-08-19T14:00:00Z',
    '2026-08-19T16:05:00Z'
  ),
  (
    'c1000000-0000-0000-0000-000000000002',
    'team_chat',
    'a0000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000002',
    'open',
    'Questions on the optimization checklist',
    'a1000000-0000-0000-0000-000000000002',
    '2026-08-19T09:58:00Z',
    '2026-08-19T12:05:00Z'
  ),
  (
    'c1000000-0000-0000-0000-000000000003',
    'team_chat',
    'a0000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000003',
    'open',
    'Getting your file started',
    'a1000000-0000-0000-0000-000000000001',
    '2026-08-18T13:30:00Z',
    '2026-08-18T15:10:00Z'
  ),
  (
    'c1000000-0000-0000-0000-000000000004',
    'team_chat',
    'a0000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000004',
    'open',
    'Welcome to Northbridge Funding Group',
    'a1000000-0000-0000-0000-000000000001',
    '2026-08-20T09:00:00Z',
    '2026-08-20T09:00:00Z'
  ),
  (
    'c1000000-0000-0000-0000-000000000005',
    'team_chat',
    'b0000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'open',
    'Welcome to Cedar Harbor Fictional Cooperative',
    'b1000000-0000-0000-0000-000000000001',
    '2026-08-18T10:00:00Z',
    '2026-08-18T11:15:00Z'
  )
-- Conflict on the natural key rather than on the id. Migration 100 allows one
-- team_chat thread per client, and a consumer who has already clicked Team Chat
-- on a running stack owns one with an id of its own. Targeting the id would make
-- the seed fail on exactly the stacks it most needs to be re-runnable on -- a
-- shared local database, or a hosted project with real activity -- and the fixed
-- ids below are for a clean reset's determinism, not a claim that no other
-- thread can exist. `id` is deliberately not in the update list: it is the key
-- other rows point at.
on conflict (client_id) where kind = 'team_chat' do update
set
  org_id = excluded.org_id,
  status = excluded.status,
  subject = excluded.subject,
  created_by = excluded.created_by,
  created_at = excluded.created_at,
  last_activity_at = excluded.last_activity_at;

do $seed_support_messages$
declare
  v_line record;
  v_message_id uuid;
  v_thread_id uuid;
begin
  -- Re-running the seed must not re-send anything. Message ids come from the
  -- RPC's default, so there is no id to conflict on: the thread already holding
  -- messages is what says the conversation happened, and a second application
  -- of the seed is a no-op rather than a doubled thread.
  if exists (
    select 1
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.kind = 'team_chat'
      and thread.client_id in (
        'a3000000-0000-0000-0000-000000000001',
        'a3000000-0000-0000-0000-000000000002',
        'a3000000-0000-0000-0000-000000000003',
        'a3000000-0000-0000-0000-000000000004',
        'b3000000-0000-0000-0000-000000000001'
      )
  ) then
    return;
  end if;

  for v_line in
    select *
    from (
      values
        -- Thread 1: the shape a team chat is supposed to have — the operator
        -- opens, the client answers, the operator closes the loop.
        (
          'a3000000-0000-0000-0000-000000000001'::uuid,
          'a1000000-0000-0000-0000-000000000002'::uuid,
          'operator'::public.support_author_kind,
          'Hi Casey, this is Priya at Northbridge Funding Group. This thread is where you and I will talk through your plan, so anything you want to ask can go here. Your Today view lists the next step whenever you are ready to pick it up.',
          'participants'::public.support_message_visibility,
          '2026-08-19T14:02:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000001'::uuid,
          'a1000000-0000-0000-0000-000000000011'::uuid,
          'consumer'::public.support_author_kind,
          'Thanks Priya. I added the two documents the checklist asked for. Is there anything else you need from me this week?',
          'participants'::public.support_message_visibility,
          '2026-08-19T15:20:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000001'::uuid,
          'a1000000-0000-0000-0000-000000000002'::uuid,
          'operator'::public.support_author_kind,
          'Both came through, thank you. Nothing else is needed today. I will read them and update your checklist tomorrow, and you will see the change on your Today view.',
          'participants'::public.support_message_visibility,
          '2026-08-19T16:05:00Z'::timestamptz
        ),
        -- Thread 2: carries the internal note, so a surface has something real
        -- to prove the note never crosses to the client side.
        (
          'a3000000-0000-0000-0000-000000000002'::uuid,
          'a1000000-0000-0000-0000-000000000002'::uuid,
          'operator'::public.support_author_kind,
          'Morning Devon. Your optimization checklist is up on your Today view now. Work through it in whatever order suits you, and ask me here if any item is unclear.',
          'participants'::public.support_message_visibility,
          '2026-08-19T10:00:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000002'::uuid,
          'a1000000-0000-0000-0000-000000000012'::uuid,
          'consumer'::public.support_author_kind,
          'Two of the items mention older accounts I no longer use. Should I do anything about those, or leave them where they are?',
          'participants'::public.support_message_visibility,
          '2026-08-19T11:12:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000002'::uuid,
          'a1000000-0000-0000-0000-000000000001'::uuid,
          'operator'::public.support_author_kind,
          'Internal note for the team: Devon asked about the two older accounts. Keeping the reply to what the checklist itself says and taking the rest to the plan review on Thursday.',
          'internal'::public.support_message_visibility,
          '2026-08-19T11:40:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000002'::uuid,
          'a1000000-0000-0000-0000-000000000002'::uuid,
          'operator'::public.support_author_kind,
          'Good question. Leave them exactly as they are for now. The checklist only asks you to confirm the account list is complete, and we will look at the rest together at your plan review on Thursday.',
          'participants'::public.support_message_visibility,
          '2026-08-19T12:05:00Z'::timestamptz
        ),
        -- Thread 3: a short opening exchange, and the thread the low-confidence
        -- draft is held against.
        (
          'a3000000-0000-0000-0000-000000000003'::uuid,
          'a1000000-0000-0000-0000-000000000001'::uuid,
          'operator'::public.support_author_kind,
          'Hi Taylor, Avery here. I have started your file and your first checklist is ready on your Today view. This thread stays open for anything you want to ask along the way.',
          'participants'::public.support_message_visibility,
          '2026-08-18T13:32:00Z'::timestamptz
        ),
        (
          'a3000000-0000-0000-0000-000000000003'::uuid,
          'a1000000-0000-0000-0000-000000000013'::uuid,
          'consumer'::public.support_author_kind,
          'Thank you. I have not borrowed much before, so I am not sure what a lender will want to see from me. Where should I start?',
          'participants'::public.support_message_visibility,
          '2026-08-18T15:10:00Z'::timestamptz
        ),
        -- Thread 4: the un-enrolled Milestone-2 slot. One outbound hello, no
        -- reply, and copy that says plainly nothing starts without Jordan.
        (
          'a3000000-0000-0000-0000-000000000004'::uuid,
          'a1000000-0000-0000-0000-000000000001'::uuid,
          'operator'::public.support_author_kind,
          'Welcome, Jordan. I am Avery at Northbridge Funding Group. Nothing starts until you authorize it, so take your time. When you are ready, the first step is on your Today view and I will be here in this thread.',
          'participants'::public.support_message_visibility,
          '2026-08-20T09:00:00Z'::timestamptz
        ),
        -- Thread 5: the second org, so anything reading across tenants has two
        -- to read across.
        (
          'b3000000-0000-0000-0000-000000000001'::uuid,
          'b1000000-0000-0000-0000-000000000001'::uuid,
          'operator'::public.support_author_kind,
          'Hello Cameron, this is Blair at Cedar Harbor Fictional Cooperative. Your workspace is open and your first checklist is on your Today view. Ask me anything here.',
          'participants'::public.support_message_visibility,
          '2026-08-18T10:02:00Z'::timestamptz
        ),
        (
          'b3000000-0000-0000-0000-000000000001'::uuid,
          'b1000000-0000-0000-0000-000000000011'::uuid,
          'consumer'::public.support_author_kind,
          'Got it, thanks Blair. I will work through the checklist this week and come back here if I get stuck.',
          'participants'::public.support_message_visibility,
          '2026-08-18T11:15:00Z'::timestamptz
        )
    ) as line (client_id, author_profile_id, author_kind, body, visibility, sent_at)
  loop
    -- The thread is resolved per line rather than named, because the row that
    -- exists may be one a consumer opened for themselves rather than the one
    -- inserted above.
    select thread.id
    into v_thread_id
    from public.support_threads as thread
    where thread.kind = 'team_chat'
      and thread.client_id = v_line.client_id;

    continue when v_thread_id is null;

    select sent.id
    into v_message_id
    from public.support_send_message(
      v_thread_id,
      v_line.author_profile_id,
      v_line.author_kind,
      v_line.body,
      null,
      v_line.visibility
    ) as sent;

    update public.support_messages
    set sent_at = v_line.sent_at
    where id = v_message_id;
  end loop;

  -- last_activity_at is the RPC's, so it now reads as this instant for every
  -- thread. Put it back to the newest message the thread actually holds, which
  -- is what an inbox sorts by.
  update public.support_threads as thread
  set last_activity_at = newest.sent_at
  from (
    select message.thread_id, max(message.sent_at) as sent_at
    from public.support_messages as message
    group by message.thread_id
  ) as newest
  where newest.thread_id = thread.id
    and thread.kind = 'team_chat'
    and thread.client_id in (
      'a3000000-0000-0000-0000-000000000001',
        'a3000000-0000-0000-0000-000000000002',
        'a3000000-0000-0000-0000-000000000003',
        'a3000000-0000-0000-0000-000000000004',
        'b3000000-0000-0000-0000-000000000001'
    );
end
$seed_support_messages$;

-- Three held drafts, one per interesting state, in three threads because
-- held_drafts_one_open_per_thread allows exactly one un-resolved draft each.
--
-- The guardrail-flagged row carries a compliant body. That is not an oversight:
-- the same language gate that produced the flag also scans this file, so the
-- sentence that earned the flag cannot be written here. What the demo needs is
-- the held state and the reason it is held, and both are present — the flag is
-- the record that the gate refused the candidate.
insert into public.held_drafts (
  id,
  thread_id,
  body,
  confidence,
  confidence_threshold,
  supervisor_approved,
  guardrail_flags,
  status,
  driver,
  model,
  prompt_key,
  prompt_version,
  created_at
)
select
  draft.id,
  thread.id,
  draft.body,
  draft.confidence,
  draft.confidence_threshold,
  draft.supervisor_approved,
  draft.guardrail_flags,
  draft.status,
  draft.driver,
  draft.model,
  draft.prompt_key,
  draft.prompt_version,
  draft.created_at
from (
  values
  (
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'a3000000-0000-0000-0000-000000000001'::uuid,
    'Both documents arrived and nothing else is outstanding this week. Your checklist will show the update once I have read them, and I will say so here when it does.',
    0.910::numeric(4,3),
    0.800::numeric(4,3),
    true,
    '{}'::text[],
    'approved'::public.held_draft_status,
    'mock',
    'mock-support-draft',
    'support-draft',
    1,
    '2026-08-19T16:10:00Z'::timestamptz
  ),
  (
    'c2000000-0000-0000-0000-000000000002'::uuid,
    'a3000000-0000-0000-0000-000000000002'::uuid,
    'This suggestion was held because the language gate refused the wording it proposed. Rewrite it in your own words before sending anything to Devon.',
    0.880::numeric(4,3),
    0.800::numeric(4,3),
    true,
    '{LANGUAGE_C04}'::text[],
    'draft'::public.held_draft_status,
    'mock',
    'mock-support-draft',
    'support-draft',
    1,
    '2026-08-19T12:10:00Z'::timestamptz
  ),
  (
    'c2000000-0000-0000-0000-000000000003'::uuid,
    'a3000000-0000-0000-0000-000000000003'::uuid,
    'A good place to start is the document list on your checklist. If any item does not apply to you, say so here and I will mark it.',
    0.410::numeric(4,3),
    0.800::numeric(4,3),
    true,
    '{}'::text[],
    'draft'::public.held_draft_status,
    'mock',
    'mock-support-draft',
    'support-draft',
    1,
    '2026-08-18T15:15:00Z'::timestamptz
  )
) as draft (
  id, client_id, body, confidence, confidence_threshold, supervisor_approved,
  guardrail_flags, status, driver, model, prompt_key, prompt_version, created_at
)
join public.support_threads as thread
  on thread.client_id = draft.client_id and thread.kind = 'team_chat'
on conflict (id) do update
set
  thread_id = excluded.thread_id,
  body = excluded.body,
  confidence = excluded.confidence,
  confidence_threshold = excluded.confidence_threshold,
  supervisor_approved = excluded.supervisor_approved,
  guardrail_flags = excluded.guardrail_flags,
  status = excluded.status,
  driver = excluded.driver,
  model = excluded.model,
  prompt_key = excluded.prompt_key,
  prompt_version = excluded.prompt_version,
  created_at = excluded.created_at;

-- Read watermarks, written through the RPC so the monotonic rule applies to the
-- seed too: a second application moves nothing, because greatest() keeps the
-- later mark. Two operators are deliberately left behind their newest incoming
-- message, so the inbox has a real unread badge rather than a uniformly read
-- one, and Jordan has no row at all — a person who has never opened a thread is
-- the state the read model has to handle first.
do $seed_support_reads$
declare
  v_mark record;
begin
  for v_mark in
    select *
    from (
      values
        ('c1000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000011'::uuid, '2026-08-19T16:10:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000002'::uuid, '2026-08-19T14:30:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000002'::uuid, 'a1000000-0000-0000-0000-000000000012'::uuid, '2026-08-19T12:30:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000002'::uuid, 'a1000000-0000-0000-0000-000000000002'::uuid, '2026-08-19T10:05:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000003'::uuid, 'a1000000-0000-0000-0000-000000000001'::uuid, '2026-08-18T15:20:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000005'::uuid, 'b1000000-0000-0000-0000-000000000011'::uuid, '2026-08-18T11:20:00Z'::timestamptz),
        ('c1000000-0000-0000-0000-000000000005'::uuid, 'b1000000-0000-0000-0000-000000000001'::uuid, '2026-08-18T11:20:00Z'::timestamptz)
    ) as mark (thread_id, profile_id, last_read_at)
  loop
    perform public.support_mark_thread_read(v_mark.thread_id, v_mark.profile_id, v_mark.last_read_at);
  end loop;
end
$seed_support_reads$;

-- Devon's timeline change-order rows. The request predates the upload so the
-- same fulfilment trigger used by live uploads records the Aug 22 transition.
insert into public.document_requests (
  id, org_id, client_id, requested_by, name, why, created_at
)
values (
  'd3960000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000002',
  'Bank statement',
  'Please send the latest statement so the checklist can be reviewed.',
  '2026-08-20T10:15:00Z'
)
on conflict (id) do nothing;

insert into public.document_uploads (
  id, org_id, client_id, kind, section, bucket, object_path,
  display_name, mime_type, size_bytes, lifecycle, uploaded_by,
  created_at, updated_at
)
values (
  'd3960000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002',
  'company',
  'bank_statements',
  'client-documents',
  'a0000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000002/d3960000-0000-0000-0000-000000000002/bank-statement-aug-2026.pdf',
  'Bank statement Aug 2026.pdf',
  'application/pdf',
  184320,
  'stored',
  'a1000000-0000-0000-0000-000000000012',
  '2026-08-22T09:40:00Z',
  '2026-08-22T09:40:00Z'
)
on conflict (id) do update
set
  section = excluded.section,
  display_name = excluded.display_name,
  mime_type = excluded.mime_type,
  size_bytes = excluded.size_bytes,
  lifecycle = excluded.lifecycle,
  updated_at = excluded.updated_at;

insert into public.document_reviews (
  id, org_id, upload_id, reviewed_by, reviewed_at
)
values (
  'd3970000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'd3960000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000002',
  '2026-08-22T11:05:00Z'
)
on conflict (id) do nothing;

insert into public.client_assignment_history (
  id, org_id, client_id, from_user, to_user, changed_by, changed_at
)
values (
  'd3980000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  '2026-08-19T09:35:00Z'
)
on conflict (id) do nothing;

insert into public.audit_log (
  id, org_id, client_id, actor_profile_id, action, subject_type,
  subject_id, occurred_at, meta
)
values (
  'd3980000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'client.assignment_changed',
  'client',
  'a3000000-0000-0000-0000-000000000002',
  '2026-08-19T09:35:00Z',
  jsonb_build_object(
    'from_state', 'a1000000-0000-0000-0000-000000000001',
    'to_state', 'a1000000-0000-0000-0000-000000000002'
  )
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Assistant conversations.
-- ---------------------------------------------------------------------------
--
-- Two operator conversations with real turns, and one platform conversation
-- with none. The empty one is deliberate: the admin scope has no grounding
-- module yet, so seeding an admin answer would put a paragraph in the history
-- that no code in this tree could have produced. An empty conversation gives
-- that surface durable data to render without inventing provenance for it.
--
-- Sources carry labels a person can read and a ref that is only ever a handle
-- for the surface to resolve. The shape is checked by
-- private.assistant_sources_valid, so a malformed row fails here rather than
-- rendering as a blank chip.
insert into public.assistant_conversations (
  id,
  scope,
  profile_id,
  org_id,
  title,
  created_at,
  last_activity_at
)
values
  (
    'c3000000-0000-0000-0000-000000000001',
    'operator',
    'a1000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Which clients are waiting on me',
    '2026-08-20T08:40:00Z',
    '2026-08-20T08:41:00Z'
  ),
  (
    'c3000000-0000-0000-0000-000000000002',
    'operator',
    'a1000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'What the Applying stage needs first',
    '2026-08-20T17:05:00Z',
    '2026-08-20T17:06:00Z'
  ),
  (
    'c3000000-0000-0000-0000-000000000003',
    'admin',
    '00000000-0000-0000-0000-000000000001',
    null,
    'New conversation',
    '2026-08-21T09:00:00Z',
    '2026-08-21T09:00:00Z'
  )
on conflict (id) do update
set
  scope = excluded.scope,
  profile_id = excluded.profile_id,
  org_id = excluded.org_id,
  title = excluded.title,
  created_at = excluded.created_at,
  last_activity_at = excluded.last_activity_at;

insert into public.assistant_turns (
  id,
  conversation_id,
  role,
  body,
  sources,
  created_at
)
values
  (
    'c4000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000001',
    'user',
    'Which of my clients are waiting on me right now?',
    '[]'::jsonb,
    '2026-08-20T08:40:00Z'
  ),
  (
    'c4000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000001',
    'assistant',
    'Two of your clients have an open item with your name on it. Casey Clean Demo sent two documents that are waiting on your read, and Devon Derog Demo asked a checklist question that is still unanswered in your team chat. Everything else in your book is waiting on the client rather than on you.',
    '[{"kind": "client", "label": "Casey Clean Demo", "ref": "tracker:a3000000-0000-0000-0000-000000000001"}, {"kind": "client", "label": "Devon Derog Demo", "ref": "tracker:a3000000-0000-0000-0000-000000000002"}]'::jsonb,
    '2026-08-20T08:41:00Z'
  ),
  (
    'c4000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000002',
    'user',
    'What does a client need to have finished before I move them into Applying?',
    '[]'::jsonb,
    '2026-08-20T17:05:00Z'
  ),
  (
    'c4000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000002',
    'assistant',
    'In your workspace a client reaches Applying once their readiness checklist has no open items and their document list is complete. Nothing about this is automatic: the stage moves when you move it, and the tracker records who did.',
    '[{"kind": "metric", "label": "Readiness checklist", "ref": "tracker:a3000000-0000-0000-0000-000000000001"}]'::jsonb,
    '2026-08-20T17:06:00Z'
  )
on conflict (id) do update
set
  conversation_id = excluded.conversation_id,
  role = excluded.role,
  body = excluded.body,
  sources = excluded.sources,
  created_at = excluded.created_at;

commit;
