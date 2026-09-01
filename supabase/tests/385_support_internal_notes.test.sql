-- 385_support_internal_notes.test.sql — chat rebuild, lane 1a.
--
-- Watched failing against the pre-migration tree (ledger head 384): every
-- assertion below that names `visibility` errored with
-- `column "visibility" does not exist`, and the two RPC refusals returned no
-- exception at all because the argument did not exist to refuse.
--
-- The assertion this file exists for is number 12: it does not list the read
-- paths that have to apply the visibility rule, it derives that list from
-- pg_proc by asking which `public.support_*` functions read
-- public.support_messages, and requires every one of them to name the shared
-- predicate. A read RPC added by a later lane that forgets the rule fails here
-- without anyone having to remember to extend a list.

begin;

set local search_path = public, extensions;

select plan(17);


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('38500000-0000-4000-8000-000000000111', 'note.owner@support.example'),
  ('38500000-0000-4000-8000-000000000113', 'note.consumer@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('38500000-0000-4000-8000-000000000001', 'Note Org', 'note-org', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '38500000-0000-4000-8000-000000000111',
    'operator_member',
    '38500000-0000-4000-8000-000000000001',
    'owner',
    'Note Owner',
    'note.owner@support.example'
  ),
  (
    '38500000-0000-4000-8000-000000000113',
    'consumer',
    '38500000-0000-4000-8000-000000000001',
    null,
    'Note Consumer',
    'note.consumer@support.example'
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
  '38500000-0000-4000-8000-000000000101',
  '38500000-0000-4000-8000-000000000001',
  '38500000-0000-4000-8000-000000000113',
  'Note Client',
  '38500000-0000-4000-8000-000000000111'
);

create temp table nid(name text primary key, id uuid) on commit drop;

insert into nid
select 'chat', id
from public.support_open_thread(
  'team_chat',
  '38500000-0000-4000-8000-000000000001',
  '38500000-0000-4000-8000-000000000101',
  'Team Chat',
  '38500000-0000-4000-8000-000000000111'
);


-- ---------------------------------------------------------------------------
-- 1. The closed vocabulary
-- ---------------------------------------------------------------------------

select has_type('public', 'support_message_visibility', 'the visibility vocabulary exists');

select enum_has_labels(
  'public',
  'support_message_visibility',
  array['participants', 'internal'],
  'visibility carries exactly the client-facing and the staff-only state'
);

select col_not_null('public', 'support_messages', 'visibility', 'every message declares who it is for');

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'support_messages'
      and column_name = 'visibility'
  ),
  '''participants''::support_message_visibility',
  'the default is the client-facing value, so a backfilled history is not silently hidden'
);


-- ---------------------------------------------------------------------------
-- 2. The two structural refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body, visibility)
    values (
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000113',
      'consumer',
      'A client cannot write a staff note.',
      'internal'
    )
  $$,
  '23514',
  null,
  'support_messages_internal_is_staff makes a client-authored note unrepresentable'
);

select throws_ok(
  $$
    insert into public.support_messages (
      thread_id, author_profile_id, author_kind, origin, origin_draft_id, body, visibility
    )
    values (
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000111',
      'operator',
      'ai_assisted',
      '38500000-0000-4000-8000-0000000009ff',
      'A note cannot claim a suggestion was sent.',
      'internal'
    )
  $$,
  '23514',
  null,
  'support_messages_internal_never_assisted refuses a note that cites a held draft'
);


-- ---------------------------------------------------------------------------
-- 3. The send RPC's own refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_send_message(
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000113',
      'consumer',
      'Please keep this between us.',
      null,
      'internal'
    )
  $$,
  'P0001',
  'SUPPORT_NOTE_NOT_PERMITTED',
  'a client asking for an internal note is refused by name, not by a check violation'
);

select throws_ok(
  $$
    select public.support_send_message(
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000111',
      'operator',
      'A note that cites a suggestion.',
      '38500000-0000-4000-8000-0000000009ff',
      'internal'
    )
  $$,
  'P0001',
  'SUPPORT_NOTE_DRAFT_CONFLICT',
  'an internal note citing a draft is refused before the draft is even looked up'
);


-- ---------------------------------------------------------------------------
-- 4. What the two audiences actually read
-- ---------------------------------------------------------------------------

insert into nid
select 'visible', id
from public.support_send_message(
  (select id from nid where name = 'chat'),
  '38500000-0000-4000-8000-000000000111',
  'operator',
  'Welcome — your funding team is here for questions about your plan.'
);

insert into nid
select 'note', id
from public.support_send_message(
  (select id from nid where name = 'chat'),
  '38500000-0000-4000-8000-000000000111',
  'operator',
  'Team note: confirm the business filing before the next check-in.',
  null,
  'internal'
);

select is(
  (
    select count(*)::integer
    from public.support_list_messages(
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000111'
    )
  ),
  2,
  'the operator read returns both the client-facing message and the note'
);

select is(
  (
    select count(*)::integer
    from public.support_list_messages(
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000113'
    )
  ),
  1,
  'the client read returns the client-facing message alone'
);

select is(
  (
    select array_agg(message.visibility::text order by message.visibility::text)
    from public.support_list_messages(
      (select id from nid where name = 'chat'),
      '38500000-0000-4000-8000-000000000113'
    ) as message
  ),
  array['participants'],
  'nothing the client can read is marked internal'
);


-- ---------------------------------------------------------------------------
-- 5. RLS, not the RPC, is what a hand-rolled query meets
-- ---------------------------------------------------------------------------
--
-- The RPC path above runs as service_role and bypasses RLS entirely, so passing
-- it proves nothing about a consumer holding an anon key and selecting the
-- table directly. This block is that second, independent proof.

set local role authenticated;
set local request.jwt.claims = '{"sub":"38500000-0000-4000-8000-000000000113","role":"authenticated"}';

select is(
  (select count(*)::integer from public.support_messages),
  1,
  'a signed-in client selecting the table directly still cannot reach the note'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"38500000-0000-4000-8000-000000000111","role":"authenticated"}';

select is(
  (select count(*)::integer from public.support_messages),
  2,
  'the same query run by the operator returns both rows, so the filter is the rule and not an outage'
);

reset role;
select set_config('request.jwt.claims', null, true);


-- ---------------------------------------------------------------------------
-- 6. A note is not activity the client sees
-- ---------------------------------------------------------------------------

select is(
  (
    select thread.last_activity_at
    from public.support_threads as thread
    where thread.id = (select id from nid where name = 'chat')
  ),
  (
    select message.sent_at
    from public.support_messages as message
    where message.id = (select id from nid where name = 'visible')
  ),
  'the thread still reads as last active when the team last spoke to the client'
);

select is(
  (
    select entry.meta ->> 'reason_code'
    from public.audit_log as entry
    where entry.subject_id = (select id from nid where name = 'note')
      and entry.action = 'support.message_sent'
  ),
  'internal_note',
  'the trail says plainly that this message never reached the client'
);


-- ---------------------------------------------------------------------------
-- 7. The rule cannot be forgotten by a read path added later
-- ---------------------------------------------------------------------------
--
-- `offset 0` is an optimization fence, load-bearing for the same reason it is
-- in tests 101 and 102: without it the planner pushes pg_get_functiondef()
-- below the namespace join and evaluates it over all of pg_catalog, where it
-- errors on the first aggregate it reaches.

select is(
  (
    select count(*)
    from (
      select p.oid
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'support\_%'
        and p.prokind = 'f'
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%from public.support_messages%'
      and pg_get_functiondef(candidate.oid) not ilike '%profile_sees_internal_support_notes%'
  ),
  0::bigint,
  'every support function that reads messages applies the shared visibility predicate'
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
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%insert into public.support_messages%'
  ),
  1::bigint,
  'replacing the writer left exactly one writer'
);

select * from finish();

rollback;
