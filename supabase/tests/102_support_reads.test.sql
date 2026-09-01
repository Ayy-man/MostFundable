-- Phase 13 · migration 102 — the read RPCs, and the rule they must not restate.
--
-- The property under test is narrower than "the right rows come back". Every
-- read path in this phase now runs as `service_role`, which bypasses RLS
-- entirely, so the only thing standing between a caller and the whole
-- `support_threads` table is the actor argument these four functions re-check.
-- Each assertion below is therefore a check that the function refused, not that
-- it filtered — and the cast is the same one migrations 100 and 101 use so the
-- three files can be read against each other.

begin;

select plan(69);

-- ---------------------------------------------------------------------------
-- Fixtures — the same cast as 100 and 101.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('13000000-0000-0000-0000-000000000900', 'platform@support.example'),
  ('13000000-0000-0000-0000-000000000111', 'owner.one@support.example'),
  ('13000000-0000-0000-0000-000000000112', 'prep.one@support.example'),
  ('13000000-0000-0000-0000-000000000113', 'consumer.one@support.example'),
  ('13000000-0000-0000-0000-000000000114', 'partner.one@support.example'),
  ('14000000-0000-0000-0000-000000000221', 'owner.two@support.example')
on conflict (id) do nothing;

insert into public.orgs (id, name, slug, team_sees_all_clients)
values
  ('13000000-0000-0000-0000-000000000001', 'Support Org One', 'support-org-one', false),
  ('14000000-0000-0000-0000-000000000002', 'Support Org Two', 'support-org-two', false)
on conflict (id) do nothing;

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  ('13000000-0000-0000-0000-000000000900', 'platform_admin', null, null,
   'Support Platform Admin', 'platform@support.example'),
  ('13000000-0000-0000-0000-000000000111', 'operator_member',
   '13000000-0000-0000-0000-000000000001', 'owner',
   'Support Owner One', 'owner.one@support.example'),
  ('13000000-0000-0000-0000-000000000112', 'operator_member',
   '13000000-0000-0000-0000-000000000001', 'prep_specialist',
   'Support Prep One', 'prep.one@support.example'),
  ('13000000-0000-0000-0000-000000000113', 'consumer',
   '13000000-0000-0000-0000-000000000001', null,
   'Support Consumer One', 'consumer.one@support.example'),
  ('13000000-0000-0000-0000-000000000114', 'affiliate',
   '13000000-0000-0000-0000-000000000001', null,
   'Support Partner One', 'partner.one@support.example'),
  ('14000000-0000-0000-0000-000000000221', 'operator_member',
   '14000000-0000-0000-0000-000000000002', 'owner',
   'Support Owner Two', 'owner.two@support.example')
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  ('13000000-0000-0000-0000-000000000101', '13000000-0000-0000-0000-000000000001',
   '13000000-0000-0000-0000-000000000113', 'Support Client One',
   '13000000-0000-0000-0000-000000000111')
on conflict (id) do nothing;

create temp table sid (name text primary key, id uuid not null);

-- One team chat, one platform support thread, one message on each, and one open
-- draft. Everything below reads this graph through the four functions.
insert into sid (name, id)
select 'chat', (public.support_open_thread(
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000101',
  'Client team chat',
  '13000000-0000-0000-0000-000000000111'
)).id;

insert into sid (name, id)
select 'platform', (public.support_open_thread(
  'platform_support',
  '13000000-0000-0000-0000-000000000001',
  null,
  'Operator question for the platform team',
  '13000000-0000-0000-0000-000000000111'
)).id;

insert into sid (name, id)
select 'chat_message', (public.support_send_message(
  (select id from sid where name = 'chat'),
  '13000000-0000-0000-0000-000000000113',
  'consumer',
  'Where do I upload the statement?'
)).id;

insert into sid (name, id)
select 'draft', (public.support_record_draft(
  (select id from sid where name = 'chat'),
  'You can add it from the documents area of your account.',
  0.86,
  0.70,
  true,
  array[]::text[],
  'mock',
  'support-draft-mock-v1',
  'support-draft',
  1,
  '13000000-0000-0000-0000-000000000111'
)).id;


-- ---------------------------------------------------------------------------
-- 1. Shape: four read functions, none of which can write.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'support_list_threads', 'support_read_thread',
       'support_list_messages', 'support_read_open_draft')),
  4::bigint,
  'migration 102 defines exactly four read functions'
);

select is(
  (select count(*)
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'support_list_threads', 'support_read_thread',
       'support_list_messages', 'support_read_open_draft')
     and p.prosecdef
     and p.provolatile = 's'
     and p.prolang = (select oid from pg_language where lanname = 'sql')
     and p.proconfig @> array['search_path=""']),
  4::bigint,
  'all four are stable, security definer, language sql, with an empty search_path'
);

-- Read from the catalog rather than asserted by review: none of the four
-- bodies contains a write. The `offset 0` fence is load-bearing here for the
-- same reason it is in test 101 — without it the planner pushes the
-- pg_get_functiondef() call below the namespace join and evaluates it over all
-- of pg_catalog, where it errors on the first aggregate it reaches.
select is(
  (select count(*)
   from (
     select p.oid
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'support_list_threads', 'support_read_thread',
         'support_list_messages', 'support_read_open_draft')
     offset 0
   ) as candidate
   where pg_get_functiondef(candidate.oid) ~* '\\m(insert|update|delete|truncate)\\M'),
  0::bigint,
  'no read function body contains a write statement'
);

-- ---------------------------------------------------------------------------
-- 2. Grants: service_role only.
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.support_list_threads(uuid, integer)', 'execute'),
  'service_role can list threads'
);
select ok(
  has_function_privilege('service_role', 'public.support_read_thread(uuid, uuid)', 'execute'),
  'service_role can read a thread'
);
select ok(
  has_function_privilege('service_role', 'public.support_list_messages(uuid, uuid, integer)', 'execute'),
  'service_role can list messages'
);
select ok(
  has_function_privilege('service_role', 'public.support_read_open_draft(uuid, uuid)', 'execute'),
  'service_role can read the open draft'
);

select ok(
  not has_function_privilege('anon', 'public.support_list_threads(uuid, integer)', 'execute'),
  'anon cannot list threads'
);
select ok(
  not has_function_privilege('authenticated', 'public.support_list_threads(uuid, integer)', 'execute'),
  'authenticated cannot list threads'
);
select ok(
  not has_function_privilege('anon', 'public.support_read_thread(uuid, uuid)', 'execute'),
  'anon cannot read a thread'
);
select ok(
  not has_function_privilege('authenticated', 'public.support_read_thread(uuid, uuid)', 'execute'),
  'authenticated cannot read a thread'
);
select ok(
  not has_function_privilege('anon', 'public.support_list_messages(uuid, uuid, integer)', 'execute'),
  'anon cannot list messages'
);
select ok(
  not has_function_privilege('authenticated', 'public.support_list_messages(uuid, uuid, integer)', 'execute'),
  'authenticated cannot list messages'
);
select ok(
  not has_function_privilege('anon', 'public.support_read_open_draft(uuid, uuid)', 'execute'),
  'anon cannot read the open draft'
);
select ok(
  not has_function_privilege('authenticated', 'public.support_read_open_draft(uuid, uuid)', 'execute'),
  'authenticated cannot read the open draft'
);

-- ---------------------------------------------------------------------------
-- 3. The rule is not restated: these functions agree with the policy helper.
-- ---------------------------------------------------------------------------
--
-- Every visibility case below is asserted twice — once through the read
-- function and once through `private.profile_can_access_support_thread`, the
-- predicate the three RLS policies use. Two answers that must always match is
-- the strongest available statement that migration 102 delegates rather than
-- reimplements: a divergence fails here rather than in production.

create temp table visibility (
  description text primary key,
  actor uuid not null,
  thread text not null,
  expected boolean not null
);

insert into visibility (description, actor, thread, expected) values
  ('the assigned owner sees the team chat', '13000000-0000-0000-0000-000000000111', 'chat', true),
  ('the client consumer sees the team chat', '13000000-0000-0000-0000-000000000113', 'chat', true),
  ('the platform admin sees the team chat', '13000000-0000-0000-0000-000000000900', 'chat', true),
  ('an unassigned prep specialist does not', '13000000-0000-0000-0000-000000000112', 'chat', false),
  ('an affiliate does not', '13000000-0000-0000-0000-000000000114', 'chat', false),
  ('another org''s owner does not', '14000000-0000-0000-0000-000000000221', 'chat', false),
  ('the operator sees their platform thread', '13000000-0000-0000-0000-000000000111', 'platform', true),
  ('an org colleague sees the platform thread', '13000000-0000-0000-0000-000000000112', 'platform', true),
  ('the platform admin sees it too', '13000000-0000-0000-0000-000000000900', 'platform', true),
  ('the consumer does not see a platform thread', '13000000-0000-0000-0000-000000000113', 'platform', false),
  ('another org''s owner does not see it', '14000000-0000-0000-0000-000000000221', 'platform', false);

select is(
  (select count(*) from public.support_read_thread(
     (select id from sid where name = v.thread), v.actor)),
  case when v.expected then 1::bigint else 0::bigint end,
  'support_read_thread: ' || v.description
)
from visibility as v;

select is(
  private.profile_can_access_support_thread(
    v.actor, (select id from sid where name = v.thread)),
  v.expected,
  'the policy helper agrees: ' || v.description
)
from visibility as v;

-- ---------------------------------------------------------------------------
-- 4. Listing, and the null actor.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.support_list_threads('13000000-0000-0000-0000-000000000111')),
  2::bigint,
  'the owner lists both of their threads'
);

select is(
  (select count(*) from public.support_list_threads('13000000-0000-0000-0000-000000000112')),
  1::bigint,
  'the unassigned prep specialist lists only the platform thread'
);

select is(
  (select count(*) from public.support_list_threads('13000000-0000-0000-0000-000000000113')),
  1::bigint,
  'the consumer lists only their own team chat'
);

select is(
  (select count(*) from public.support_list_threads('13000000-0000-0000-0000-000000000114')),
  0::bigint,
  'the affiliate lists nothing'
);

select is(
  (select count(*) from public.support_list_threads('14000000-0000-0000-0000-000000000221')),
  0::bigint,
  'the other org lists nothing'
);

-- A null actor is the shape an unauthenticated caller arrives in once the
-- service key is in play, and it must be zero rows rather than every row.
select is(
  (select count(*) from public.support_list_threads(null)),
  0::bigint,
  'a null actor lists nothing'
);
select is(
  (select count(*) from public.support_read_thread(
     (select id from sid where name = 'chat'), null)),
  0::bigint,
  'a null actor reads no thread'
);
select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'), null)),
  0::bigint,
  'a null actor reads no message'
);
select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'), null)),
  0::bigint,
  'a null actor reads no draft'
);

select is(
  (select count(*) from public.support_list_threads(
     '13000000-0000-0000-0000-000000000111', 0)),
  0::bigint,
  'a zero limit returns nothing rather than everything'
);

select is(
  (select count(*) from public.support_list_threads(
     '13000000-0000-0000-0000-000000000111', -5)),
  0::bigint,
  'a negative limit is clamped to zero rather than raising'
);

-- ---------------------------------------------------------------------------
-- 5. Messages follow the thread, not the author.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  1::bigint,
  'the owner reads the message on the team chat'
);

select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000113')),
  1::bigint,
  'the consumer reads their own message back'
);

select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000112')),
  0::bigint,
  'a staff member without thread access reads no message from it'
);

select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'),
     '14000000-0000-0000-0000-000000000221')),
  0::bigint,
  'the other org reads no message from it'
);

-- ---------------------------------------------------------------------------
-- 6. Drafts are staff-side in SQL, not only in TypeScript.
-- ---------------------------------------------------------------------------
--
-- SUPP-02's consumer half. The repository skips the draft query for a consumer
-- role, and these assertions are why that skip is an optimization rather than
-- the control: a consumer who reached this function directly still gets
-- nothing, and a draft demonstrably exists for them to have missed.

select is(
  (select count(*) from public.held_drafts
   where thread_id = (select id from sid where name = 'chat')),
  1::bigint,
  'there is a draft on the team chat to be denied'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  1::bigint,
  'the assigned owner reads the open draft'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000900')),
  1::bigint,
  'the platform admin reads it too'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000113')),
  0::bigint,
  'the consumer on that very thread reads no draft'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000114')),
  0::bigint,
  'the affiliate reads no draft'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000112')),
  0::bigint,
  'a staff member without thread access reads no draft'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '14000000-0000-0000-0000-000000000221')),
  0::bigint,
  'the other org reads no draft'
);

-- Only the open statuses. A discarded draft is history, and a sent one is a
-- message now; neither is the thread's current draft.
select public.support_discard_draft(
  (select id from sid where name = 'draft'),
  '13000000-0000-0000-0000-000000000111'
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  0::bigint,
  'a discarded draft is no longer the thread''s open draft'
);

select is(
  (select count(*) from public.held_drafts
   where thread_id = (select id from sid where name = 'chat')),
  1::bigint,
  'the discarded row is still there — it left the read, not the table'
);

insert into sid (name, id)
select 'draft_two', (public.support_record_draft(
  (select id from sid where name = 'chat'),
  'Happy to help — you can add it from the documents area.',
  0.86,
  0.70,
  true,
  array[]::text[],
  'mock',
  'support-draft-mock-v1',
  'support-draft',
  1,
  '13000000-0000-0000-0000-000000000111'
)).id;

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  1::bigint,
  'a fresh approved draft is the open one'
);

select public.support_send_message(
  (select id from sid where name = 'chat'),
  '13000000-0000-0000-0000-000000000111',
  'operator',
  'Happy to help — you can add it from the documents area.',
  (select id from sid where name = 'draft_two')
);

select is(
  (select count(*) from public.support_read_open_draft(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  0::bigint,
  'a sent draft is no longer open either'
);

select is(
  (select count(*) from public.support_list_messages(
     (select id from sid where name = 'chat'),
     '13000000-0000-0000-0000-000000000111')),
  2::bigint,
  'the sent draft became exactly one message'
);

-- ---------------------------------------------------------------------------
-- 7. A thread that does not exist reads the same as one that is not visible.
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.support_read_thread(
     '13000000-0000-0000-0000-0000000000ff',
     '13000000-0000-0000-0000-000000000111')),
  0::bigint,
  'an absent thread id returns no rows rather than raising'
);

select is(
  (select count(*) from public.support_list_messages(
     '13000000-0000-0000-0000-0000000000ff',
     '13000000-0000-0000-0000-000000000111')),
  0::bigint,
  'an absent thread id yields no messages'
);

select is(
  (select count(*) from public.support_read_open_draft(
     '13000000-0000-0000-0000-0000000000ff',
     '13000000-0000-0000-0000-000000000111')),
  0::bigint,
  'an absent thread id yields no draft'
);

-- ---------------------------------------------------------------------------
-- 8. The reads leave no audit trail of their own.
-- ---------------------------------------------------------------------------
--
-- Migration 101 audits every write. A read is not an event, and a read that
-- wrote an audit row would give the append-only log a growth rate set by page
-- views rather than by decisions.

create temp table audit_before as
select count(*) as total from public.audit_log;

select is(
  (select count(*) from public.support_list_threads('13000000-0000-0000-0000-000000000111'))
  + (select count(*) from public.support_read_thread(
       (select id from sid where name = 'chat'), '13000000-0000-0000-0000-000000000111'))
  + (select count(*) from public.support_list_messages(
       (select id from sid where name = 'chat'), '13000000-0000-0000-0000-000000000111'))
  + (select count(*) from public.support_read_open_draft(
       (select id from sid where name = 'chat'), '13000000-0000-0000-0000-000000000111')),
  5::bigint,
  'the four reads returned rows, so the next assertion is about a real run'
);

select is(
  (select count(*) from public.audit_log),
  (select total from audit_before),
  'reading wrote no audit row'
);

select * from finish();

rollback;
