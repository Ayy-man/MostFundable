-- 101_support_send_guard.test.sql — Phase 13 (S2.5).
--
-- Proves the behavioural half of SUPP-01: exactly one function in the schema
-- can create a support message, it refuses seven distinct ways before it will,
-- concurrency cannot turn one approved draft into two messages, and every state
-- change leaves an audit row that carries metadata and no message text.
--
-- The counterpart file 100_support_threads.test.sql proves the structural half
-- with no functions involved. Between them, a reviewer who trusts neither the
-- application nor the reviewer's own reading of the SQL still gets the property.

begin;

set local search_path = public, extensions;

select plan(108);


-- ---------------------------------------------------------------------------
-- Fixtures — the same cast as 100_support_threads.test.sql, so the two files
-- read the same way. Org one has team_sees_all_clients = false, which is what
-- makes profile …112 (a prep specialist who is not assigned to client one) a
-- genuine "right role, wrong client" case rather than a role check in disguise.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('13000000-0000-0000-0000-000000000900', 'platform@support.example'),
  ('13000000-0000-0000-0000-000000000111', 'owner.one@support.example'),
  ('13000000-0000-0000-0000-000000000112', 'prep.one@support.example'),
  ('13000000-0000-0000-0000-000000000113', 'consumer.one@support.example'),
  ('13000000-0000-0000-0000-000000000114', 'partner.one@support.example'),
  ('14000000-0000-0000-0000-000000000221', 'owner.two@support.example'),
  ('14000000-0000-0000-0000-000000000222', 'consumer.two@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values
  ('13000000-0000-0000-0000-000000000001', 'Support Org One', 'support-org-one', false),
  ('14000000-0000-0000-0000-000000000002', 'Support Org Two', 'support-org-two', false);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '13000000-0000-0000-0000-000000000900',
    'platform_admin',
    null,
    null,
    'Support Platform Admin',
    'platform@support.example'
  ),
  (
    '13000000-0000-0000-0000-000000000111',
    'operator_member',
    '13000000-0000-0000-0000-000000000001',
    'owner',
    'Support Owner One',
    'owner.one@support.example'
  ),
  (
    '13000000-0000-0000-0000-000000000112',
    'operator_member',
    '13000000-0000-0000-0000-000000000001',
    'prep_specialist',
    'Support Prep One',
    'prep.one@support.example'
  ),
  (
    '13000000-0000-0000-0000-000000000113',
    'consumer',
    '13000000-0000-0000-0000-000000000001',
    null,
    'Support Consumer One',
    'consumer.one@support.example'
  ),
  (
    '13000000-0000-0000-0000-000000000114',
    'affiliate',
    '13000000-0000-0000-0000-000000000001',
    null,
    'Support Partner One',
    'partner.one@support.example'
  ),
  (
    '14000000-0000-0000-0000-000000000221',
    'operator_member',
    '14000000-0000-0000-0000-000000000002',
    'owner',
    'Support Owner Two',
    'owner.two@support.example'
  ),
  (
    '14000000-0000-0000-0000-000000000222',
    'consumer',
    '14000000-0000-0000-0000-000000000002',
    null,
    'Support Consumer Two',
    'consumer.two@support.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  (
    '13000000-0000-0000-0000-000000000101',
    '13000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000113',
    'Support Client One',
    '13000000-0000-0000-0000-000000000111'
  ),
  (
    '14000000-0000-0000-0000-000000000202',
    '14000000-0000-0000-0000-000000000002',
    '14000000-0000-0000-0000-000000000222',
    'Support Client Two',
    '14000000-0000-0000-0000-000000000221'
  );

-- Ids the RPCs mint are captured here rather than hard-coded, so the tests
-- exercise the functions' own defaults instead of a value the test chose.
create temp table sid (name text primary key, id uuid not null);

-- Every body and subject below is checked at the end of this file for absence
-- from the audit metadata. None of them contains any of the literal values the
-- functions place in `meta` ('open', 'sent', 'draft', 'mock', 'pending', …), so
-- that assertion fails loudly the day someone adds a body excerpt to a meta key.


-- ---------------------------------------------------------------------------
-- 1. The single-writer property, read from the catalog
-- ---------------------------------------------------------------------------

-- `offset 0` is an optimization fence, and it is load-bearing: without it the
-- planner pushes the pg_get_functiondef() restriction below the namespace join
-- and evaluates it over all of pg_catalog, where it errors on the first
-- aggregate it reaches.
select is(
  (
    select count(*)
    from (
      select p.oid
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%insert into public.support_messages%'
  ),
  1::bigint,
  'exactly one function in the schema inserts into support_messages'
);

select is(
  (
    select candidate.qualified_name
    from (
      select p.oid, n.nspname || '.' || p.proname as qualified_name
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%insert into public.support_messages%'
  ),
  'public.support_send_message',
  'the one writer is public.support_send_message'
);

select is(
  (
    select count(*)
    from (
      select p.oid
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
        and p.proname in (
          'support_open_thread',
          'support_record_draft',
          'support_discard_draft',
          'support_set_thread_status',
          'audit_support_event'
        )
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%insert into public.support_messages%'
  ),
  0::bigint,
  'the four thread and draft functions cannot create a message'
);

-- The inventory is a name list rather than a count. A count told you the number
-- had moved and left you to find out how; a list names the function that
-- arrived, which is the difference between a failing test that explains itself
-- and one that sends you to `git log`. Either way this is an enumeration on
-- purpose: a function added to this namespace by any lane must show up here as
-- a failing test rather than as nothing at all.
--
-- Six from migrations 100 and 101 (the five write RPCs plus the audit helper),
-- four reads from migration 102, and two from migration 386 — the watermark
-- writer and the digest that derives an unread count from the messages.
select results_eq(
  $$
    select (n.nspname::text || '.' || p.proname::text) collate "C"
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'support\_%')
       or (n.nspname = 'private' and p.proname = 'audit_support_event')
    order by 1
  $$,
  $$
    values
      ('private.audit_support_event'::text collate "C"),
      ('public.support_discard_draft'),
      ('public.support_list_messages'),
      ('public.support_list_thread_digest'),
      ('public.support_list_threads'),
      ('public.support_mark_thread_read'),
      ('public.support_open_thread'),
      ('public.support_read_open_draft'),
      ('public.support_read_thread'),
      ('public.support_record_draft'),
      ('public.support_send_message'),
      ('public.support_set_thread_status')
  $$,
  'the support namespace holds exactly the functions this phase declares'
);

select is(
  (
    select count(*)
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where (
        (n.nspname = 'public' and p.proname like 'support\_%')
        or (n.nspname = 'private' and p.proname = 'audit_support_event')
      )
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ),
  -- Derived from the same inventory the assertion above pins, so the two cannot
  -- drift: every function in that list, and nothing else, must run definer with
  -- an empty search path.
  (
    select count(*)
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'support\_%')
       or (n.nspname = 'private' and p.proname = 'audit_support_event')
  ),
  'every support function runs security definer with an empty search path'
);

-- The signature is resolved from the catalog rather than spelled out: migration
-- 385 replaced this function with a six-argument form, and a test that names the
-- argument list has to be edited every time the writer gains a parameter — which
-- is exactly the transcription that rots. `insert into public.support_messages`
-- identifies the writer uniquely, as the three assertions above establish.
select matches(
  (
    select pg_get_functiondef(candidate.oid)
    from (
      select p.oid
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'support_send_message'
        and p.prokind = 'f'
      offset 0
    ) as candidate
  ),
  '(?i)for update',
  'the send path locks the draft row before it inserts a message'
);


-- ---------------------------------------------------------------------------
-- 2. Privilege — a browser session holds none of it
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege(
    'authenticated',
    'public.support_open_thread(public.support_thread_kind,uuid,uuid,text,uuid)',
    'execute'
  ),
  false,
  'authenticated cannot execute support_open_thread'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.support_record_draft(uuid,text,numeric,numeric,boolean,text[],text,text,text,integer,uuid)',
    'execute'
  ),
  false,
  'authenticated cannot execute support_record_draft'
);

select is(
  has_function_privilege('authenticated', 'public.support_discard_draft(uuid,uuid)', 'execute'),
  false,
  'authenticated cannot execute support_discard_draft'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.support_set_thread_status(uuid,public.support_thread_status,uuid)',
    'execute'
  ),
  false,
  'authenticated cannot execute support_set_thread_status'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.support_send_message(uuid,uuid,public.support_author_kind,text,uuid,public.support_message_visibility)',
    'execute'
  ),
  false,
  'authenticated cannot execute support_send_message'
);

select is(
  has_function_privilege(
    'anon',
    'public.support_send_message(uuid,uuid,public.support_author_kind,text,uuid,public.support_message_visibility)',
    'execute'
  ),
  false,
  'anon cannot execute support_send_message'
);

select is(
  has_function_privilege(
    'service_role',
    'public.support_open_thread(public.support_thread_kind,uuid,uuid,text,uuid)',
    'execute'
  ),
  true,
  'service_role can execute support_open_thread'
);

select is(
  has_function_privilege(
    'service_role',
    'public.support_record_draft(uuid,text,numeric,numeric,boolean,text[],text,text,text,integer,uuid)',
    'execute'
  ),
  true,
  'service_role can execute support_record_draft'
);

select is(
  has_function_privilege('service_role', 'public.support_discard_draft(uuid,uuid)', 'execute'),
  true,
  'service_role can execute support_discard_draft'
);

select is(
  has_function_privilege(
    'service_role',
    'public.support_set_thread_status(uuid,public.support_thread_status,uuid)',
    'execute'
  ),
  true,
  'service_role can execute support_set_thread_status'
);

select is(
  has_function_privilege(
    'service_role',
    'public.support_send_message(uuid,uuid,public.support_author_kind,text,uuid,public.support_message_visibility)',
    'execute'
  ),
  true,
  'service_role can execute support_send_message'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.audit_support_event(uuid,uuid,uuid,text,text,uuid,jsonb)',
    'execute'
  ),
  false,
  'authenticated cannot execute the audit writer'
);

select is(
  has_function_privilege(
    'service_role',
    'private.audit_support_event(uuid,uuid,uuid,text,text,uuid,jsonb)',
    'execute'
  ),
  true,
  'service_role can execute the audit writer'
);


-- ---------------------------------------------------------------------------
-- 3. Opening a thread
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Client team chat',
      null
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'opening a thread with no actor is refused first'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Client team chat',
      '13000000-0000-0000-0000-0000000000ff'
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_UNKNOWN',
  'opening a thread as a profile that does not exist is refused'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Client team chat',
      '13000000-0000-0000-0000-000000000114'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'an affiliate cannot open a team chat'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Client team chat',
      '14000000-0000-0000-0000-000000000222'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'a consumer cannot open a team chat on another consumer client'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      null,
      'Operator question one',
      '14000000-0000-0000-0000-000000000221'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'an operator cannot open a platform thread against another org'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      null,
      'Operator question one',
      '13000000-0000-0000-0000-000000000113'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'a consumer cannot open a platform thread'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      null,
      'Client team chat',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a team chat without a client is refused by name, not by raw check violation'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Operator question one',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a platform thread carrying a client is refused by name'
);

select throws_ok(
  $$
    select public.support_open_thread(
      'team_chat',
      '14000000-0000-0000-0000-000000000002',
      '13000000-0000-0000-0000-000000000101',
      'Client team chat',
      '13000000-0000-0000-0000-000000000900'
    )
  $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a client that does not belong to the named org is refused before any insert'
);

insert into sid
select 'chat', id
from public.support_open_thread(
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000101',
  'Client team chat',
  '13000000-0000-0000-0000-000000000111'
);

insert into sid
select 'chat_again', id
from public.support_open_thread(
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000101',
  'A different subject line entirely',
  '13000000-0000-0000-0000-000000000113'
);

select is(
  (select id from sid where name = 'chat_again'),
  (select id from sid where name = 'chat'),
  'a second team chat call returns the existing thread rather than a unique violation'
);

select is(
  (
    select count(*)
    from public.support_threads
    where client_id = '13000000-0000-0000-0000-000000000101'
  ),
  1::bigint,
  'the client still has exactly one team chat'
);

select is(
  (
    select subject
    from public.support_threads
    where id = (select id from sid where name = 'chat')
  ),
  'Client team chat',
  'the idempotent call returned the existing row unchanged'
);

select is(
  (
    select count(*)
    from public.audit_log
    where subject_id = (select id from sid where name = 'chat')
      and action = 'support.thread_opened'
  ),
  1::bigint,
  'the idempotent call appended no second audit row'
);

insert into sid
select 'plat', id
from public.support_open_thread(
  'platform_support',
  '13000000-0000-0000-0000-000000000001',
  null,
  'Operator question one',
  '13000000-0000-0000-0000-000000000111'
);

insert into sid
select 'plat_two', id
from public.support_open_thread(
  'platform_support',
  '13000000-0000-0000-0000-000000000001',
  null,
  'Operator question two',
  '13000000-0000-0000-0000-000000000111'
);

select isnt(
  (select id from sid where name = 'plat_two'),
  (select id from sid where name = 'plat'),
  'platform threads are not capped at one per org'
);

select is(
  (
    select count(*)
    from public.support_threads
    where kind = 'platform_support'
      and org_id = '13000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'both platform threads exist for the org'
);

select is(
  (
    select status::text
    from public.support_threads
    where id = (select id from sid where name = 'chat')
  ),
  'open',
  'a newly opened thread starts open'
);

select is(
  (
    select created_by
    from public.support_threads
    where id = (select id from sid where name = 'chat')
  ),
  '13000000-0000-0000-0000-000000000111'::uuid,
  'the thread records the human who opened it'
);


-- ---------------------------------------------------------------------------
-- 4. Recording a draft
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_record_draft(
      (select id from sid where name = 'chat'),
      'A body a consumer should never be able to store.',
      0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000113'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'a consumer cannot record a draft even on a thread they can read'
);

select throws_ok(
  $$
    select public.support_record_draft(
      (select id from sid where name = 'chat'),
      'A body an unassigned specialist should not be able to store.',
      0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000112'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'the right role on the wrong client is still refused'
);

select throws_ok(
  $$
    select public.support_record_draft(
      (select id from sid where name = 'chat'),
      'A body from the wrong org.',
      0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '14000000-0000-0000-0000-000000000221'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'an operator in another org cannot record a draft'
);

select throws_ok(
  $$
    select public.support_record_draft(
      (select id from sid where name = 'chat'),
      'A body with no actor at all.',
      0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      null
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'recording a draft with no actor is refused first'
);

-- Low confidence: the supervisor approved and nothing is flagged, so the only
-- thing keeping this unsendable is the number.
insert into sid
select 'd_low', id
from public.support_record_draft(
  (select id from sid where name = 'chat'),
  'I will follow up here as soon as I have an update.',
  0.400, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
  '13000000-0000-0000-0000-000000000111'
);

select is(
  (select status::text from public.held_drafts where id = (select id from sid where name = 'd_low')),
  'draft',
  'confidence below the threshold yields an unsendable draft'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'd_low')
      and action = 'support.draft_recorded'
  ),
  'confidence_below_threshold',
  'the audit row names the gate that held it'
);

select throws_ok(
  $$
    select public.support_record_draft(
      (select id from sid where name = 'chat'),
      'A second body while the first is still open.',
      0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_EXISTS',
  'a second open draft is refused rather than silently superseding the first'
);

select throws_ok(
  $$ select public.support_discard_draft(
       '13000000-0000-0000-0000-0000000000ff',
       '13000000-0000-0000-0000-000000000111'
     ) $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_FOUND',
  'discarding a draft that does not exist is refused'
);

select throws_ok(
  $$
    select public.support_discard_draft(
      (select id from sid where name = 'd_low'),
      '13000000-0000-0000-0000-000000000112'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'discarding needs the same access recording needed'
);

select lives_ok(
  $$
    select public.support_discard_draft(
      (select id from sid where name = 'd_low'),
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'an operator with access can discard the open draft'
);

select is(
  (select status::text from public.held_drafts where id = (select id from sid where name = 'd_low')),
  'discarded',
  'the discarded draft carries the discarded status'
);

select is(
  (select discarded_by from public.held_drafts where id = (select id from sid where name = 'd_low')),
  '13000000-0000-0000-0000-000000000111'::uuid,
  'the discard names the human who did it'
);

select isnt(
  (select discarded_at from public.held_drafts where id = (select id from sid where name = 'd_low')),
  null,
  'the discard is timestamped'
);

select throws_ok(
  $$
    select public.support_discard_draft(
      (select id from sid where name = 'd_low'),
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_OPEN',
  'a draft cannot be discarded twice'
);

-- Supervisor rejection outranks everything else in the reason code.
insert into sid
select 'd_rejected', id
from public.support_record_draft(
  (select id from sid where name = 'chat'),
  'The bank statement upload link is in your checklist.',
  0.950, 0.700, false, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
  '13000000-0000-0000-0000-000000000111'
);

select is(
  (
    select status::text
    from public.held_drafts
    where id = (select id from sid where name = 'd_rejected')
  ),
  'draft',
  'a supervisor rejection holds a high-confidence body back'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'd_rejected')
  ),
  'supervisor_rejected',
  'the supervisor gate wins the reason code'
);

select lives_ok(
  $$
    select public.support_discard_draft(
      (select id from sid where name = 'd_rejected'),
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'the rejected draft is discarded to free the thread slot'
);

-- Flagged language: the supervisor passed it and the number is high, so the
-- flag array is the only thing standing in the way.
insert into sid
select 'd_flagged', id
from public.support_record_draft(
  (select id from sid where name = 'chat'),
  'A quick note about the timeline for your file.',
  0.990, 0.700, true, array['LANGUAGE_C01'], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
  '13000000-0000-0000-0000-000000000111'
);

select is(
  (
    select status::text
    from public.held_drafts
    where id = (select id from sid where name = 'd_flagged')
  ),
  'draft',
  'a flagged body is held back at full confidence'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'd_flagged')
  ),
  'guardrail_flagged',
  'the flag array names itself in the audit row'
);

select is(
  (
    select (meta ->> 'count')::integer
    from public.audit_log
    where subject_id = (select id from sid where name = 'd_flagged')
  ),
  1,
  'the audit row counts the flags without naming the body'
);


-- ---------------------------------------------------------------------------
-- 5. The send guard's seven refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      null,
      'operator',
      'A message with no human behind it.'
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'a send with a null actor is refused before anything else runs'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-0000000000ff',
      'operator',
      'A message from a profile that does not exist.'
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_UNKNOWN',
  'a send from an unknown profile is refused'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000112',
      'operator',
      'A message from the right role on the wrong client.'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'an unassigned specialist cannot send into the client chat'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '14000000-0000-0000-0000-000000000222',
      'consumer',
      'A message from another org consumer.'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'a consumer cannot send into another consumer client chat'
);

select lives_ok(
  $$
    select public.support_set_thread_status(
      (select id from sid where name = 'plat_two'),
      'resolved',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'an operator with access can resolve their platform thread'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'plat_two'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'A message into a thread that is already closed.'
    )
  $$,
  'P0001',
  'SUPPORT_THREAD_CLOSED',
  'a resolved thread takes no further messages'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'A message naming a draft that does not exist.',
      '13000000-0000-0000-0000-0000000000ff'
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_FOUND',
  'a send naming a draft that does not exist is refused'
);

insert into sid
select 'd_other_thread', id
from public.support_record_draft(
  (select id from sid where name = 'plat'),
  'Thanks for the question, the team will reply here.',
  0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
  '13000000-0000-0000-0000-000000000111'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'Thanks for the question, the team will reply here.',
      (select id from sid where name = 'd_other_thread')
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_FOUND',
  'an approved draft belonging to another thread cannot be sent into this one'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'A quick note about the timeline for your file.',
      (select id from sid where name = 'd_flagged')
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_APPROVED',
  'a draft still in draft status cannot be sent'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'I will follow up here as soon as I have an update.',
      (select id from sid where name = 'd_low')
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_APPROVED',
  'a discarded draft cannot be sent'
);

select lives_ok(
  $$
    select public.support_discard_draft(
      (select id from sid where name = 'd_flagged'),
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'the flagged draft is discarded to free the thread slot'
);

insert into sid
select 'd_approved', id
from public.support_record_draft(
  (select id from sid where name = 'chat'),
  'Your file is with the team and I will follow up here.',
  0.900, 0.700, true, '{}'::text[], 'mock', 'support-draft-mock-v1', 'support-draft', 1,
  '13000000-0000-0000-0000-000000000111'
);

select is(
  (
    select status::text
    from public.held_drafts
    where id = (select id from sid where name = 'd_approved')
  ),
  'approved',
  'all three gates clear leaves the draft approved'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'd_approved')
  ),
  'gates_passed',
  'the audit row records that every gate cleared'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'Your file is with the team and I will follow up here!',
      (select id from sid where name = 'd_approved')
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_BODY_MISMATCH',
  'one changed character is enough to refuse attributing the text to the draft'
);

select is(
  (
    select count(*)
    from public.support_messages
    where thread_id = (select id from sid where name = 'chat')
  ),
  0::bigint,
  'none of the refusals left a message behind'
);

-- Scoped to this file's own fixture org. The claim is that THESE refusals wrote
-- no audit row, and an unscoped count says instead that nothing anywhere ever
-- sent a message -- which stops being true the moment the seed, or another
-- test, sends one. The org id is the fixture's, so the scope moves with it.
select is(
  (
    select count(*)
    from public.audit_log as entry
    where entry.action = 'support.message_sent'
      and entry.org_id = '13000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'a refused send appends no audit row'
);


-- ---------------------------------------------------------------------------
-- 6. The happy paths
-- ---------------------------------------------------------------------------

insert into sid
select 'msg_human', id
from public.support_send_message(
  (select id from sid where name = 'chat'),
  '13000000-0000-0000-0000-000000000111',
  'operator',
  'Thanks, I have logged your question for the team.'
);

select is(
  (
    select origin::text
    from public.support_messages
    where id = (select id from sid where name = 'msg_human')
  ),
  'human',
  'a send with no draft is recorded as a human message'
);

select is(
  (
    select origin_draft_id
    from public.support_messages
    where id = (select id from sid where name = 'msg_human')
  ),
  null,
  'a human message claims no draft'
);

select is(
  (
    select count(*)
    from public.held_drafts
    where thread_id = (select id from sid where name = 'chat')
      and status = 'sent'
  ),
  0::bigint,
  'a human send leaves every draft untouched'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'msg_human')
  ),
  'human_send',
  'the audit row distinguishes an unassisted send'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'consumer',
      'A message claiming the wrong author kind.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'the migration 100 trigger still checks the author kind against the profile role'
);

insert into sid
select 'msg_assisted', id
from public.support_send_message(
  (select id from sid where name = 'chat'),
  '13000000-0000-0000-0000-000000000111',
  'operator',
  'Your file is with the team and I will follow up here.',
  (select id from sid where name = 'd_approved')
);

select is(
  (
    select origin::text
    from public.support_messages
    where id = (select id from sid where name = 'msg_assisted')
  ),
  'ai_assisted',
  'a send that names an approved draft is recorded as assisted'
);

select is(
  (
    select origin_draft_id
    from public.support_messages
    where id = (select id from sid where name = 'msg_assisted')
  ),
  (select id from sid where name = 'd_approved'),
  'the assisted message points back at the draft it came from'
);

select is(
  (
    select status::text
    from public.held_drafts
    where id = (select id from sid where name = 'd_approved')
  ),
  'sent',
  'the draft is marked sent in the same transaction'
);

select is(
  (
    select sent_by
    from public.held_drafts
    where id = (select id from sid where name = 'd_approved')
  ),
  '13000000-0000-0000-0000-000000000111'::uuid,
  'the draft names the human who sent it'
);

select isnt(
  (
    select sent_at
    from public.held_drafts
    where id = (select id from sid where name = 'd_approved')
  ),
  null,
  'the send is timestamped on the draft'
);

select is(
  (
    select sent_message_id
    from public.held_drafts
    where id = (select id from sid where name = 'd_approved')
  ),
  (select id from sid where name = 'msg_assisted'),
  'the pairing trigger accepted a draft and message that point at each other'
);

select is(
  (
    select meta ->> 'reason_code'
    from public.audit_log
    where subject_id = (select id from sid where name = 'msg_assisted')
  ),
  'human_send_ai_assisted',
  'the audit row distinguishes an assisted send from an unassisted one'
);

insert into sid
select 'msg_consumer', id
from public.support_send_message(
  (select id from sid where name = 'chat'),
  '13000000-0000-0000-0000-000000000113',
  'consumer',
  'Adding a quick reply from my side.'
);

select is(
  (
    select author_kind::text
    from public.support_messages
    where id = (select id from sid where name = 'msg_consumer')
  ),
  'consumer',
  'a consumer reaches the same single writer as the operator does'
);

select is(
  (
    select last_activity_at
    from public.support_threads
    where id = (select id from sid where name = 'chat')
  ),
  (
    select sent_at
    from public.support_messages
    where id = (select id from sid where name = 'msg_consumer')
  ),
  'the thread activity clock follows the newest message'
);


-- ---------------------------------------------------------------------------
-- 7. Concurrency
-- ---------------------------------------------------------------------------
--
-- `030_analysis_jobs.test.sql` proves its lock from the function source rather
-- than by opening a second backend, so this file follows that convention rather
-- than introducing dblink here. The source assertion in section 1 shows the
-- draft is taken `for update`, which is what forces two concurrent senders to
-- serialize; the assertions below then prove the loser's outcome once it does,
-- because the winner has already flipped the draft out of `approved`.

select throws_ok(
  $$
    select public.support_send_message(
      (select id from sid where name = 'chat'),
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'Your file is with the team and I will follow up here.',
      (select id from sid where name = 'd_approved')
    )
  $$,
  'P0001',
  'SUPPORT_DRAFT_NOT_APPROVED',
  'the second sender of one approved draft is refused once the first has won'
);

select is(
  (
    select count(*)
    from public.support_messages
    where origin_draft_id = (select id from sid where name = 'd_approved')
  ),
  1::bigint,
  'one approved draft produced exactly one message'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.support_messages'::regclass
      and conname = 'support_messages_origin_draft_unique'
      and contype = 'u'
  ),
  1::bigint,
  'a unique constraint backs the lock if the lock is ever removed'
);


-- ---------------------------------------------------------------------------
-- 8. Thread status transitions
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_set_thread_status(
      (select id from sid where name = 'chat'),
      'pending',
      '13000000-0000-0000-0000-000000000112'
    )
  $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'moving a thread status needs thread access'
);

select throws_ok(
  $$
    select public.support_set_thread_status(
      (select id from sid where name = 'chat'),
      'pending',
      null
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'moving a thread status with no actor is refused'
);

select lives_ok(
  $$
    select public.support_set_thread_status(
      (select id from sid where name = 'chat'),
      'pending',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'an operator with access can move the thread to pending'
);

select is(
  (
    select status::text
    from public.support_threads
    where id = (select id from sid where name = 'chat')
  ),
  'pending',
  'the thread carries the new status'
);

select is(
  (
    select count(*)
    from public.audit_log
    where subject_id = (select id from sid where name = 'chat')
      and action = 'support.thread_status_changed'
  ),
  1::bigint,
  'the status change appended exactly one audit row'
);

select lives_ok(
  $$
    select public.support_set_thread_status(
      (select id from sid where name = 'chat'),
      'pending',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'setting the status it already has succeeds'
);

select is(
  (
    select count(*)
    from public.audit_log
    where subject_id = (select id from sid where name = 'chat')
      and action = 'support.thread_status_changed'
  ),
  1::bigint,
  'a no-op status change appends no audit row'
);


-- ---------------------------------------------------------------------------
-- 9. The audit trail for the whole sequence
-- ---------------------------------------------------------------------------

create temp table chat_scope as
select (select id from sid where name = 'chat') as id
union
select id from public.held_drafts where thread_id = (select id from sid where name = 'chat')
union
select id from public.support_messages where thread_id = (select id from sid where name = 'chat');

-- occurred_at defaults to now(), which is the transaction timestamp and so is
-- identical for every row this file writes, and id is a random UUID; ctid is
-- NOT insertion-stable either (vacuum lets inserts backfill freed pages, which
-- is exactly what flaked in CI). With no monotonic key, intra-transaction
-- order is unobservable to any reader, so the honest contract is that the
-- trail records exactly these twelve events for this scope.
select is(
  (
    select array_agg(entry.action order by entry.action)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id
  ),
  (
    select array_agg(expected.action order by expected.action)
    from unnest(array[
      'support.thread_opened',
      'support.draft_recorded',
      'support.draft_discarded',
      'support.draft_recorded',
      'support.draft_discarded',
      'support.draft_recorded',
      'support.draft_discarded',
      'support.draft_recorded',
      'support.message_sent',
      'support.message_sent',
      'support.message_sent',
      'support.thread_status_changed'
    ]::text[]) as expected(action)
  ),
  'the audit trail records exactly the twelve events of the sequence'
);

select is(
  (
    select array_agg(distinct entry.subject_type order by entry.subject_type)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id
  ),
  array['held_draft', 'support_message', 'support_thread']::text[],
  'every audit row names one of the three expected subject types'
);

select is(
  (
    select array_agg(distinct meta_key order by meta_key)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where entry.action = 'support.thread_opened'
  ),
  array['source', 'status']::text[],
  'thread_opened metadata is exactly source and status'
);

select is(
  (
    select array_agg(distinct meta_key order by meta_key)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where entry.action = 'support.draft_recorded'
  ),
  array['count', 'driver', 'reason_code', 'status', 'version']::text[],
  'draft_recorded metadata is exactly the five expected keys'
);

select is(
  (
    select array_agg(distinct meta_key order by meta_key)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where entry.action = 'support.draft_discarded'
  ),
  array['from_state', 'to_state']::text[],
  'draft_discarded metadata is exactly from_state and to_state'
);

select is(
  (
    select array_agg(distinct meta_key order by meta_key)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where entry.action = 'support.message_sent'
  ),
  array['reason_code', 'source', 'status']::text[],
  'message_sent metadata is exactly reason_code, source and status'
);

select is(
  (
    select array_agg(distinct meta_key order by meta_key)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where entry.action = 'support.thread_status_changed'
  ),
  array['from_state', 'to_state']::text[],
  'thread_status_changed metadata is exactly from_state and to_state'
);

-- The Phase 3 check constraint already rejects an unknown key, so this asserts
-- the complementary property: every key the phase does use is on the list.
select is(
  (
    select count(*)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_object_keys(entry.meta) as meta_key
    where meta_key not in (
      'count', 'driver', 'field_names', 'from_state',
      'job', 'reason_code', 'source', 'status', 'to_state', 'version'
    )
  ),
  0::bigint,
  'no audit row uses a key outside the Phase 3 allow list'
);

-- The substantive privacy assertion: no metadata value appears anywhere in the
-- message bodies, draft bodies, or thread subject. A truncated or hashed
-- excerpt smuggled into meta would trip this.
select is(
  (
    select count(*)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id,
      lateral jsonb_each_text(entry.meta) as pair(meta_key, meta_value)
    where length(pair.meta_value) >= 4
      and exists (
        select 1
        from (
          select body as text_value
          from public.support_messages
          where thread_id = (select id from sid where name = 'chat')
          union all
          select body
          from public.held_drafts
          where thread_id = (select id from sid where name = 'chat')
          union all
          select subject
          from public.support_threads
          where id = (select id from sid where name = 'chat')
        ) as authored
        where position(pair.meta_value in authored.text_value) > 0
      )
  ),
  0::bigint,
  'no audit metadata value occurs in any body or subject line'
);

select is(
  (
    select count(*)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id
    where entry.actor_profile_id is null
  ),
  0::bigint,
  'every audit row this phase writes names a human actor'
);

select is(
  (
    select count(*)
    from public.audit_log as entry
    join chat_scope on chat_scope.id = entry.subject_id
    where entry.org_id is distinct from '13000000-0000-0000-0000-000000000001'::uuid
       or entry.client_id is distinct from '13000000-0000-0000-0000-000000000101'::uuid
  ),
  0::bigint,
  'every team chat audit row is anchored to the right org and client'
);

select is(
  (
    select count(*)
    from public.audit_log as entry
    where entry.subject_id = (select id from sid where name = 'plat')
      and entry.org_id = '13000000-0000-0000-0000-000000000001'::uuid
      and entry.client_id is null
  ),
  1::bigint,
  'a platform thread anchors to the org with no client'
);


select * from finish();

rollback;
