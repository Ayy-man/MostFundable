-- 393_support_counterpart_read_receipt.test.sql — the read receipt's derivation.
--
-- Watched failing against the pre-migration tree (ledger head 392): every
-- assertion errored with `column digest.counterpart_read_at does not exist`, and
-- the side assertions had no `private.support_thread_side` to call at all.
--
-- No instant below is written down. Each expectation is recomputed from
-- public.support_thread_reads in the assertion, with its own predicate over the
-- profiles it means, so the digest and the expectation have to move together to
-- stay green. That is the round-5 standard, and it is what makes assertion 4
-- able to catch a derivation that started counting a colleague on the reader's
-- own side even though the fixture never changes.

begin;

set local search_path = public, extensions;

select plan(9);


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Four people, and the fourth is the point: two operators in one org, so that
-- "somebody other than me read this" and "the client read this" are different
-- facts that a wrong derivation would collapse into one.

insert into auth.users (id, email)
values
  ('39300000-0000-4000-8000-000000000111', 'receipt.owner@support.example'),
  ('39300000-0000-4000-8000-000000000112', 'receipt.colleague@support.example'),
  ('39300000-0000-4000-8000-000000000113', 'receipt.consumer@support.example'),
  ('39300000-0000-4000-8000-000000000114', 'receipt.admin@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('39300000-0000-4000-8000-000000000001', 'Receipt Org', 'receipt-org', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '39300000-0000-4000-8000-000000000111',
    'operator_member',
    '39300000-0000-4000-8000-000000000001',
    'owner',
    'Receipt Owner',
    'receipt.owner@support.example'
  ),
  (
    '39300000-0000-4000-8000-000000000112',
    'operator_member',
    '39300000-0000-4000-8000-000000000001',
    'admin',
    'Receipt Colleague',
    'receipt.colleague@support.example'
  ),
  (
    '39300000-0000-4000-8000-000000000113',
    'consumer',
    '39300000-0000-4000-8000-000000000001',
    null,
    'Receipt Consumer',
    'receipt.consumer@support.example'
  ),
  (
    '39300000-0000-4000-8000-000000000114',
    'platform_admin',
    null,
    null,
    'Receipt Platform',
    'receipt.admin@support.example'
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
  '39300000-0000-4000-8000-000000000101',
  '39300000-0000-4000-8000-000000000001',
  '39300000-0000-4000-8000-000000000113',
  'Receipt Client',
  '39300000-0000-4000-8000-000000000111'
);

create temp table rid(name text primary key, id uuid) on commit drop;

insert into rid
select 'chat', id
from public.support_open_thread(
  'team_chat',
  '39300000-0000-4000-8000-000000000001',
  '39300000-0000-4000-8000-000000000101',
  'Team Chat',
  '39300000-0000-4000-8000-000000000111'
);

-- A second thread with no consumer on it at all, so the platform_support split
-- is exercised rather than assumed to fall out of the team_chat one.
insert into rid
select 'platform', id
from public.support_open_thread(
  'platform_support',
  '39300000-0000-4000-8000-000000000001',
  null,
  'Billing question',
  '39300000-0000-4000-8000-000000000111'
);

insert into rid
select 'greeting', id
from public.support_send_message(
  (select id from rid where name = 'chat'),
  '39300000-0000-4000-8000-000000000111',
  'operator',
  'Welcome. Your funding team is here for questions about your plan.'
);


-- ---------------------------------------------------------------------------
-- 1. Nobody has opened anything yet
-- ---------------------------------------------------------------------------

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  null::timestamptz,
  'a thread the client has never opened says nothing about whether they read it'
);


-- ---------------------------------------------------------------------------
-- 2. A colleague on the reader's own side is not a counterpart
-- ---------------------------------------------------------------------------
--
-- The colleague's mark is written first and alone. If the derivation were
-- `max(last_read_at) where profile_id <> actor`, this is the assertion that
-- would go red: an operator would be told the client had read a message that the
-- client has not opened, which is the one wrong thing a receipt can say.

select public.support_mark_thread_read(
  (select id from rid where name = 'chat'),
  '39300000-0000-4000-8000-000000000112',
  now() - interval '2 hours'
);

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  null::timestamptz,
  'a colleague opening the thread is not the client having read it'
);


-- ---------------------------------------------------------------------------
-- 3. The consumer's watermark, and only the consumer's
-- ---------------------------------------------------------------------------

select public.support_mark_thread_read(
  (select id from rid where name = 'chat'),
  '39300000-0000-4000-8000-000000000113',
  now() - interval '10 minutes'
);

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  (
    select mark.last_read_at
    from public.support_thread_reads as mark
    join public.clients as client
      on client.consumer_profile_id = mark.profile_id
    where mark.thread_id = (select id from rid where name = 'chat')
      and client.id = '39300000-0000-4000-8000-000000000101'
  ),
  'the operator is told when the client opened the thread, recomputed from the client''s own row'
);

-- The colleague's mark is older than the client's, so a derivation that took the
-- greatest of everyone else would still be right above. This is the assertion
-- that separates them: the colleague is moved AHEAD of the client, and the
-- answer must not move with it.
select public.support_mark_thread_read(
  (select id from rid where name = 'chat'),
  '39300000-0000-4000-8000-000000000112',
  now()
);

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  (
    select mark.last_read_at
    from public.support_thread_reads as mark
    where mark.thread_id = (select id from rid where name = 'chat')
      and mark.profile_id = '39300000-0000-4000-8000-000000000113'
  ),
  'a colleague reading it more recently than the client does not move the receipt'
);

select is(
  (
    select digest.counterpart_read_at <
      (
        select mark.last_read_at
        from public.support_thread_reads as mark
        where mark.thread_id = (select id from rid where name = 'chat')
          and mark.profile_id = '39300000-0000-4000-8000-000000000112'
      )
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  true,
  'the answer is strictly behind the colleague''s mark, so it is not a max over everybody'
);


-- ---------------------------------------------------------------------------
-- 4. The consumer's view: the greatest mark on the team side
-- ---------------------------------------------------------------------------
--
-- Two staff watermarks now stand on this thread, at different instants, and the
-- expectation is recomputed as a max over the team side rather than named.

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000113') as digest
    where digest.thread_id = (select id from rid where name = 'chat')
  ),
  (
    select max(mark.last_read_at)
    from public.support_thread_reads as mark
    join public.profiles as staff on staff.id = mark.profile_id
    where mark.thread_id = (select id from rid where name = 'chat')
      and staff.role in ('operator_member', 'platform_admin')
  ),
  'the client is told the most recent moment anybody on their team opened the thread'
);


-- ---------------------------------------------------------------------------
-- 5. platform_support divides by role, because it has no consumer
-- ---------------------------------------------------------------------------

select public.support_mark_thread_read(
  (select id from rid where name = 'platform'),
  '39300000-0000-4000-8000-000000000114',
  now() - interval '5 minutes'
);

select is(
  (
    select digest.counterpart_read_at
    from public.support_list_thread_digest('39300000-0000-4000-8000-000000000111') as digest
    where digest.thread_id = (select id from rid where name = 'platform')
  ),
  (
    select mark.last_read_at
    from public.support_thread_reads as mark
    where mark.thread_id = (select id from rid where name = 'platform')
      and mark.profile_id = '39300000-0000-4000-8000-000000000114'
  ),
  'on a platform thread the operator''s counterpart is the platform staff who answered'
);


-- ---------------------------------------------------------------------------
-- 6. The table's policy is untouched
-- ---------------------------------------------------------------------------
--
-- Migration 386's comment said a counterpart's read time would be a policy
-- change a reviewer can see. It is not one: the derivation is inside a security
-- definer function and the table still hands a signed-in session its own row and
-- nothing else. Both halves are asserted, because the grant surviving and the
-- policy surviving are two different regressions.

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_thread_reads'
      and qual like '%auth_profile_id%'
  ),
  1,
  'the watermark table still scopes a signed-in read to the caller''s own profile'
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
  'a signed-in session still reads a watermark and writes nothing'
);

select * from finish();

rollback;
