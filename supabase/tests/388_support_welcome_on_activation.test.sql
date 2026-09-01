-- 388_support_welcome_on_activation.test.sql — chat rebuild, lane 1a.
--
-- Watched failing against the pre-migration tree (ledger head 387): assertion 1
-- reported `have: 0 / want: 1` for the trigger, and every behavioural assertion
-- below it found zero messages after activation, because nothing wrote one.
--
-- Nothing here transcribes the welcome copy. Assertion 5 asks
-- private.support_welcome_body for the sentence and compares that to the stored
-- row, and assertion 6 takes the brand out of public.orgs, so a reworded welcome
-- moves both sides at once and a welcome that stopped naming the operator's
-- brand fails on its own. The counts are recomputed from public.support_messages
-- rather than remembered.

begin;

set local search_path = public, extensions;

select plan(14);


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('38800000-0000-4000-8000-000000000111', 'welcome.owner@support.example'),
  ('38800000-0000-4000-8000-000000000112', 'welcome.prep@support.example'),
  ('38800000-0000-4000-8000-000000000113', 'welcome.a@support.example'),
  ('38800000-0000-4000-8000-000000000114', 'welcome.b@support.example'),
  ('38800000-0000-4000-8000-000000000115', 'welcome.c@support.example'),
  ('38800000-0000-4000-8000-000000000116', 'welcome.d@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values
  ('38800000-0000-4000-8000-000000000001', 'Welcome Fictional Group', 'welcome-fictional', true),
  ('38800000-0000-4000-8000-000000000002', 'Voiceless Fictional Group', 'voiceless-fictional', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  ('38800000-0000-4000-8000-000000000111', 'operator_member', '38800000-0000-4000-8000-000000000001', 'owner', 'Wynn Welcome Owner', 'welcome.owner@support.example'),
  ('38800000-0000-4000-8000-000000000112', 'operator_member', '38800000-0000-4000-8000-000000000001', 'prep_specialist', 'Pat Welcome Prep', 'welcome.prep@support.example'),
  ('38800000-0000-4000-8000-000000000113', 'consumer', '38800000-0000-4000-8000-000000000001', null, 'Consumer Assigned', 'welcome.a@support.example'),
  ('38800000-0000-4000-8000-000000000114', 'consumer', '38800000-0000-4000-8000-000000000001', null, 'Consumer Unassigned', 'welcome.b@support.example'),
  ('38800000-0000-4000-8000-000000000115', 'consumer', '38800000-0000-4000-8000-000000000001', null, 'Consumer Already Talking', 'welcome.c@support.example'),
  ('38800000-0000-4000-8000-000000000116', 'consumer', '38800000-0000-4000-8000-000000000002', null, 'Consumer Without A Team', 'welcome.d@support.example')
on conflict (id) do update
set role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role,
    full_name = excluded.full_name, email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  ('38800000-0000-4000-8000-000000000101', '38800000-0000-4000-8000-000000000001', '38800000-0000-4000-8000-000000000113', 'Assigned Client', '38800000-0000-4000-8000-000000000112'),
  ('38800000-0000-4000-8000-000000000102', '38800000-0000-4000-8000-000000000001', '38800000-0000-4000-8000-000000000114', 'Unassigned Client', null),
  ('38800000-0000-4000-8000-000000000103', '38800000-0000-4000-8000-000000000001', '38800000-0000-4000-8000-000000000115', 'Talking Client', '38800000-0000-4000-8000-000000000112'),
  ('38800000-0000-4000-8000-000000000104', '38800000-0000-4000-8000-000000000002', '38800000-0000-4000-8000-000000000116', 'Voiceless Client', null);

-- The third client is already mid-conversation before it activates.
create temp table wel(name text primary key, id uuid) on commit drop;

insert into wel
select 'talking', id
from public.support_open_thread(
  'team_chat',
  '38800000-0000-4000-8000-000000000001',
  '38800000-0000-4000-8000-000000000103',
  'Started already',
  '38800000-0000-4000-8000-000000000112'
);

insert into wel
select 'talking_first', id
from public.support_send_message(
  (select id from wel where name = 'talking'),
  '38800000-0000-4000-8000-000000000112',
  'operator',
  'We spoke on the phone earlier, so I am picking that up here.'
);

-- The product's own authority refuses an enrollment without matching consent
-- grants, so the fixture grants them first. That refusal is the reason the
-- welcome cannot possibly precede consent: there is no enrollment to activate
-- until both grants exist and match.
insert into public.consents (client_id, kind, action, text_version, signed_at, ip, esig_ref)
select
  grant_row.client_id,
  grant_row.kind::public.consent_kind,
  'granted'::public.consent_action,
  'welcome-fixture-v1',
  '2026-08-20T09:00:00Z'::timestamptz,
  '203.0.113.10'::inet,
  grant_row.esig_ref
from (
  values
    ('38800000-0000-4000-8000-000000000101'::uuid, 'monitoring', 'esig-a'),
    ('38800000-0000-4000-8000-000000000101'::uuid, 'analysis', 'esig-a'),
    ('38800000-0000-4000-8000-000000000102'::uuid, 'monitoring', 'esig-b'),
    ('38800000-0000-4000-8000-000000000102'::uuid, 'analysis', 'esig-b'),
    ('38800000-0000-4000-8000-000000000103'::uuid, 'monitoring', 'esig-c'),
    ('38800000-0000-4000-8000-000000000103'::uuid, 'analysis', 'esig-c'),
    ('38800000-0000-4000-8000-000000000104'::uuid, 'monitoring', 'esig-d'),
    ('38800000-0000-4000-8000-000000000104'::uuid, 'analysis', 'esig-d')
) as grant_row (client_id, kind, esig_ref);

insert into public.enrollments (id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id)
values
  ('38800000-0000-4000-8000-000000000201', '38800000-0000-4000-8000-000000000101', 'enrolled', '2026-08-20T09:00:00Z', '2026-08-20T09:00:00Z', 'esig-a'),
  ('38800000-0000-4000-8000-000000000202', '38800000-0000-4000-8000-000000000102', 'enrolled', '2026-08-20T09:00:00Z', '2026-08-20T09:00:00Z', 'esig-b'),
  ('38800000-0000-4000-8000-000000000203', '38800000-0000-4000-8000-000000000103', 'enrolled', '2026-08-20T09:00:00Z', '2026-08-20T09:00:00Z', 'esig-c'),
  ('38800000-0000-4000-8000-000000000204', '38800000-0000-4000-8000-000000000104', 'enrolled', '2026-08-20T09:00:00Z', '2026-08-20T09:00:00Z', 'esig-d');


-- ---------------------------------------------------------------------------
-- 1. The hook itself, read from the catalog
-- ---------------------------------------------------------------------------

-- Derived rather than named: the assertion is that ONE enabled row-level AFTER
-- UPDATE trigger on public.enrollments calls this lane's function. A trigger
-- renamed, disabled, or demoted to BEFORE fails here without the test having to
-- guess which of those somebody did.
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger as hook
    join pg_catalog.pg_proc as handler on handler.oid = hook.tgfoid
    join pg_catalog.pg_namespace as handler_schema on handler_schema.oid = handler.pronamespace
    where hook.tgrelid = 'public.enrollments'::regclass
      and not hook.tgisinternal
      and hook.tgenabled <> 'D'
      and (hook.tgtype & 1) = 1   -- FOR EACH ROW
      and (hook.tgtype & 2) = 0   -- AFTER
      and (hook.tgtype & 16) = 16 -- UPDATE
      and handler_schema.nspname = 'private'
      and handler.proname = 'enrollment_seed_support_welcome'
  ),
  1,
  'one enabled AFTER UPDATE row trigger on enrollments seeds the welcome'
);


-- ---------------------------------------------------------------------------
-- 2. Activation writes the welcome
-- ---------------------------------------------------------------------------

update public.enrollments set status = 'active' where id = '38800000-0000-4000-8000-000000000201';

select is(
  (
    select count(*)::integer
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  1,
  'activating an enrollment leaves exactly one message in the client team chat'
);

select is(
  (
    select message.author_profile_id
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  (
    select client.assigned_to
    from public.clients as client
    where client.id = '38800000-0000-4000-8000-000000000101'
  ),
  'the welcome is authored by the operator the client is assigned to'
);

-- The four columns that together say "a person sent this, unaided, to the
-- client". Any one of them wrong is the no-auto-reply property leaking.
select is(
  (
    select array[message.author_kind::text, message.origin::text, message.visibility::text,
                 (message.origin_draft_id is null)::text]
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  array['operator', 'human', 'participants', 'true'],
  'the welcome is a human operator message to the participants, with no draft behind it'
);

select is(
  (
    select message.body
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  (
    select private.support_welcome_body(organization.name, author.full_name)
    from public.clients as client
    join public.orgs as organization on organization.id = client.org_id
    join public.profiles as author on author.id = client.assigned_to
    where client.id = '38800000-0000-4000-8000-000000000101'
  ),
  'the stored welcome is exactly what the copy function produces for this org and operator'
);

-- Plan §2 says the welcome comes from the operator's brand. Taking the brand out
-- of public.orgs rather than writing it here is what makes this fail if the copy
-- ever stops naming it.
select ok(
  (
    select pg_catalog.strpos(message.body, organization.name) > 0
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    join public.orgs as organization on organization.id = thread.org_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  'the welcome names the operator brand the consumer sees everywhere else'
);

-- Written through the send RPC, not around it: the audit row is the observable
-- difference between the two, and a direct insert would leave none.
select is(
  (
    select count(*)::integer
    from public.audit_log as entry
    where entry.action = 'support.message_sent'
      and entry.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  1,
  'the welcome went through support_send_message, so it left the same audit row any send leaves'
);

select is(
  (
    select count(*)::integer
    from public.support_list_messages(
      (select thread.id from public.support_threads as thread where thread.client_id = '38800000-0000-4000-8000-000000000101'),
      '38800000-0000-4000-8000-000000000113'
    )
  ),
  1,
  'the consumer can read their own welcome'
);


-- ---------------------------------------------------------------------------
-- 3. The guards
-- ---------------------------------------------------------------------------

update public.enrollments set status = 'parked', parked_until = '2026-09-01T00:00:00Z' where id = '38800000-0000-4000-8000-000000000201';
update public.enrollments set status = 'active', parked_until = null where id = '38800000-0000-4000-8000-000000000201';

select is(
  (
    select count(*)::integer
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000101'
  ),
  1,
  'a client who parks and re-activates is not welcomed twice'
);

update public.enrollments set status = 'active' where id = '38800000-0000-4000-8000-000000000202';

select is(
  (
    select message.author_profile_id
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000102'
  ),
  (
    select profile.id
    from public.profiles as profile
    where profile.org_id = '38800000-0000-4000-8000-000000000001'
      and profile.role = 'operator_member'
      and profile.org_role = 'owner'
      and profile.disabled_at is null
    order by profile.created_at, profile.id
    limit 1
  ),
  'an unassigned client is welcomed by an owner of its org rather than by nobody'
);

update public.enrollments set status = 'active' where id = '38800000-0000-4000-8000-000000000203';

select is(
  (
    select array_agg(message.body order by message.sent_at)
    from public.support_messages as message
    where message.thread_id = (select id from wel where name = 'talking')
  ),
  array['We spoke on the phone earlier, so I am picking that up here.'],
  'a thread somebody has already started gets no hello dropped into the middle of it'
);

update public.enrollments set status = 'active' where id = '38800000-0000-4000-8000-000000000204';

select is(
  (
    select array[
      (select count(*)::text
       from public.support_threads as thread
       where thread.client_id = '38800000-0000-4000-8000-000000000104'),
      (select status::text from public.enrollments where id = '38800000-0000-4000-8000-000000000204')
    ]
  ),
  array['0', 'active'],
  'an org with nobody to speak seeds nothing and the activation still completes'
);

update public.enrollments set status = 'parked', parked_until = '2026-09-01T00:00:00Z' where id = '38800000-0000-4000-8000-000000000202';

select is(
  (
    select count(*)::integer
    from public.support_messages as message
    join public.support_threads as thread on thread.id = message.thread_id
    where thread.client_id = '38800000-0000-4000-8000-000000000102'
  ),
  1,
  'a transition to any status other than active writes nothing'
);

-- The property the whole file exists to protect: this runs inside the
-- transaction that charges somebody, so it must have no way to raise.
select lives_ok(
  $$ select private.seed_support_welcome('38800000-0000-4000-8000-0000000009ff'::uuid) $$,
  'seeding a welcome for a client that does not exist returns rather than aborting the activation'
);


select finish();

rollback;
