-- 386_support_thread_reads.test.sql — chat rebuild, lane 1a.
--
-- Watched failing against the pre-migration tree (ledger head 385): every
-- assertion errored with `relation "public.support_thread_reads" does not exist`
-- or `function public.support_list_thread_digest(...) does not exist`, and the
-- monotonicity and clamp cases had no function to call at all.
--
-- The counts below are never written down. Each expected number is recomputed
-- in the assertion from public.support_messages by a query written independently
-- of the digest — a different join order, a different exclusion — so a change to
-- either side has to move both to stay green. That is the round-5 standard, and
-- it is why assertion 6 would catch a digest that started counting a person's
-- own messages even though the fixture never changes.

begin;

set local search_path = public, extensions;

select plan(12);


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('38600000-0000-4000-8000-000000000111', 'read.owner@support.example'),
  ('38600000-0000-4000-8000-000000000113', 'read.consumer@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('38600000-0000-4000-8000-000000000001', 'Watermark Org', 'watermark-org', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '38600000-0000-4000-8000-000000000111',
    'operator_member',
    '38600000-0000-4000-8000-000000000001',
    'owner',
    'Watermark Owner',
    'read.owner@support.example'
  ),
  (
    '38600000-0000-4000-8000-000000000113',
    'consumer',
    '38600000-0000-4000-8000-000000000001',
    null,
    'Watermark Consumer',
    'read.consumer@support.example'
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
  '38600000-0000-4000-8000-000000000101',
  '38600000-0000-4000-8000-000000000001',
  '38600000-0000-4000-8000-000000000113',
  'Watermark Client',
  '38600000-0000-4000-8000-000000000111'
);

create temp table wid(name text primary key, id uuid) on commit drop;

insert into wid
select 'chat', id
from public.support_open_thread(
  'team_chat',
  '38600000-0000-4000-8000-000000000001',
  '38600000-0000-4000-8000-000000000101',
  'Team Chat',
  '38600000-0000-4000-8000-000000000111'
);

-- Two from the team, one from the client, and one staff note. The mix is what
-- makes the derived expectations below able to disagree with the digest.
insert into wid
select 'first', id
from public.support_send_message(
  (select id from wid where name = 'chat'),
  '38600000-0000-4000-8000-000000000111',
  'operator',
  'Welcome — your funding team is here for questions about your plan.'
);

insert into wid
select 'reply', id
from public.support_send_message(
  (select id from wid where name = 'chat'),
  '38600000-0000-4000-8000-000000000113',
  'consumer',
  'Thanks — what should I work on first this week?'
);

insert into wid
select 'note', id
from public.support_send_message(
  (select id from wid where name = 'chat'),
  '38600000-0000-4000-8000-000000000111',
  'operator',
  'Team note: check the business filing date before replying.',
  null,
  'internal'
);

insert into wid
select 'answer', id
from public.support_send_message(
  (select id from wid where name = 'chat'),
  '38600000-0000-4000-8000-000000000111',
  'operator',
  'Start with the two documents listed on your plan, then message us here.'
);


-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

select has_table('public', 'support_thread_reads', 'the watermark table exists');

select col_is_pk(
  'public',
  'support_thread_reads',
  array['thread_id', 'profile_id'],
  'one watermark per person per thread, so there is no winner to pick later'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'support_thread_reads'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  1,
  'the watermark table enables and forces row level security like its three siblings'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'support_thread_reads'
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ),
  0,
  'a signed-in session can read a watermark and write nothing, so the RPC is the only writer'
);


-- ---------------------------------------------------------------------------
-- 2. The count is derived, and it is derived correctly
-- ---------------------------------------------------------------------------
--
-- The expectation on the right is computed here from public.support_messages
-- with its own predicate; nothing transcribes a number from the fixture.

select is(
  (
    select digest.unread_count
    from public.support_list_thread_digest('38600000-0000-4000-8000-000000000113') as digest
    where digest.thread_id = (select id from wid where name = 'chat')
  ),
  (
    select count(*)::integer
    from public.support_messages as message
    where message.thread_id = (select id from wid where name = 'chat')
      and message.author_profile_id <> '38600000-0000-4000-8000-000000000113'
      and message.visibility = 'participants'
  ),
  'an unopened thread counts every message the client may read and did not write'
);

select is(
  (
    select digest.unread_count
    from public.support_list_thread_digest('38600000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from wid where name = 'chat')
  ),
  (
    select count(*)::integer
    from public.support_messages as message
    where message.thread_id = (select id from wid where name = 'chat')
      and message.author_profile_id <> '38600000-0000-4000-8000-000000000111'
  ),
  'the operator''s count excludes their own messages and includes the note they can read'
);

select is(
  (
    select digest.last_message_preview
    from public.support_list_thread_digest('38600000-0000-4000-8000-000000000113') as digest
    where digest.thread_id = (select id from wid where name = 'chat')
  ),
  (
    select left(btrim(message.body), 140)
    from public.support_messages as message
    where message.thread_id = (select id from wid where name = 'chat')
      and message.visibility = 'participants'
    order by message.sent_at desc, message.id desc
    limit 1
  ),
  'the client''s preview is the newest message the client may read'
);


-- ---------------------------------------------------------------------------
-- 3. Marking read
-- ---------------------------------------------------------------------------

-- The mark runs as its own statement rather than as a subquery beside the
-- digest: nothing orders a volatile function against a stable one inside a
-- single query, so folding the two together would be asserting on whichever
-- order the planner happened to choose.
select public.support_mark_thread_read(
  (select id from wid where name = 'chat'),
  '38600000-0000-4000-8000-000000000113',
  now()
);

select is(
  (
    select digest.unread_count
    from public.support_list_thread_digest('38600000-0000-4000-8000-000000000113') as digest
    where digest.thread_id = (select id from wid where name = 'chat')
  ),
  0,
  'marking the thread read clears the badge'
);

-- Monotonic. An older mark arriving late — a stale render finishing after a
-- fresh one — must not resurrect messages the person has already read.
select is(
  (
    select (
      public.support_mark_thread_read(
        (select id from wid where name = 'chat'),
        '38600000-0000-4000-8000-000000000113',
        now() - interval '30 days'
      )
    ).last_read_at > now() - interval '1 minute'
  ),
  true,
  'an older mark arriving late does not walk the watermark backwards'
);

-- Clamped. A browser clock a year fast would otherwise mute the thread forever,
-- and it is the one unread-badge failure a person cannot see or correct.
select is(
  (
    select (
      public.support_mark_thread_read(
        (select id from wid where name = 'chat'),
        '38600000-0000-4000-8000-000000000111',
        now() + interval '365 days'
      )
    ).last_read_at <= now()
  ),
  true,
  'a mark from the future is clamped to now, so a wrong clock cannot mute a thread'
);


-- ---------------------------------------------------------------------------
-- 4. Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.support_mark_thread_read(
      (select id from wid where name = 'chat'),
      null,
      now()
    )
  $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'there is no anonymous watermark'
);

select is(
  (
    select count(*)::integer
    from public.support_list_thread_digest('38600000-0000-4000-8000-000000000113') as digest
    where digest.thread_id <> (select id from wid where name = 'chat')
  ),
  0,
  'the digest answers only for threads the actor can already reach'
);

select * from finish();

rollback;
