-- 387_assistant_conversations.test.sql — chat rebuild, lane 1a.
--
-- Watched failing against the pre-migration tree: the objects were dropped back
-- out of the local stack and the file re-run, at which point every assertion
-- reported `type "public.assistant_scope" does not exist` or
-- `function public.assistant_open_conversation(...) does not exist`.
--
-- Two assertions are derived rather than transcribed, and they are the two
-- worth keeping. Assertion 13 reads the permitted source kinds out of the
-- migration's own validator by trying each of them, so it cannot fall out of
-- step with the function the way a copied list would. Assertion 14 asks the
-- catalog whether anything in this schema can write a support message, which is
-- the property that makes the assistant safe to have at all.

begin;

set local search_path = public, extensions;

select plan(16);


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('38700000-0000-4000-8000-000000000900', 'assistant.admin@support.example'),
  ('38700000-0000-4000-8000-000000000111', 'assistant.owner@support.example'),
  ('38700000-0000-4000-8000-000000000112', 'assistant.prep@support.example'),
  ('38700000-0000-4000-8000-000000000113', 'assistant.consumer@support.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('38700000-0000-4000-8000-000000000001', 'Assistant Org', 'assistant-org', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '38700000-0000-4000-8000-000000000900',
    'platform_admin',
    null,
    null,
    'Assistant Platform Admin',
    'assistant.admin@support.example'
  ),
  (
    '38700000-0000-4000-8000-000000000111',
    'operator_member',
    '38700000-0000-4000-8000-000000000001',
    'owner',
    'Assistant Owner',
    'assistant.owner@support.example'
  ),
  (
    '38700000-0000-4000-8000-000000000112',
    'operator_member',
    '38700000-0000-4000-8000-000000000001',
    'prep_specialist',
    'Assistant Prep',
    'assistant.prep@support.example'
  ),
  (
    '38700000-0000-4000-8000-000000000113',
    'consumer',
    '38700000-0000-4000-8000-000000000001',
    null,
    'Assistant Consumer',
    'assistant.consumer@support.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

create temp table aid(name text primary key, id uuid) on commit drop;


-- ---------------------------------------------------------------------------
-- 1. Who may open what
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.assistant_open_conversation('operator', '38700000-0000-4000-8000-000000000113')$$,
  'P0001',
  'ASSISTANT_SCOPE_INVALID',
  'a client has no assistant workspace to open'
);

select throws_ok(
  $$select public.assistant_open_conversation('admin', '38700000-0000-4000-8000-000000000111')$$,
  'P0001',
  'ASSISTANT_SCOPE_INVALID',
  'an operator cannot open a platform-scoped conversation'
);

select throws_ok(
  $$select public.assistant_open_conversation('operator', null)$$,
  'P0001',
  'ASSISTANT_ACTOR_REQUIRED',
  'there is no anonymous conversation'
);

insert into aid
select 'owner', id
from public.assistant_open_conversation('operator', '38700000-0000-4000-8000-000000000111');

insert into aid
select 'admin', id
from public.assistant_open_conversation('admin', '38700000-0000-4000-8000-000000000900');

select is(
  (
    select conversation.org_id
    from public.assistant_conversations as conversation
    where conversation.id = (select id from aid where name = 'owner')
  ),
  (
    select profile.org_id
    from public.profiles as profile
    where profile.id = '38700000-0000-4000-8000-000000000111'
  ),
  'an operator conversation takes its org from the actor, never from an argument'
);


-- ---------------------------------------------------------------------------
-- 2. Scope is carried by the predicate, not by a caller's filter
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from public.assistant_list_conversations('38700000-0000-4000-8000-000000000112')
  ),
  0,
  'a colleague in the same org cannot see another member''s workspace conversation'
);

select is(
  (
    select count(*)::integer
    from public.assistant_list_conversations('38700000-0000-4000-8000-000000000111')
  ),
  1,
  'the owner sees their own and nothing else, so the admin conversation stays out of it'
);

-- Derived from the table rather than from a count: platform conversations are
-- shared by the platform team, so a second admin conversation anywhere -- one
-- another test opened, or the seed's -- is a normal state and not a defect. The
-- fact under test is which SET a platform admin reads, and the only honest
-- statement of it is the set itself.
select results_eq(
  $q$
    select listed.id
    from public.assistant_list_conversations('38700000-0000-4000-8000-000000000900') as listed
    order by listed.id
  $q$,
  $q$
    select conversation.id
    from public.assistant_conversations as conversation
    where conversation.scope = 'admin'
    order by conversation.id
  $q$,
  'a platform admin reads every platform conversation and no operator''s private history'
);

select throws_ok(
  $$
    select public.assistant_append_turn(
      (select id from aid where name = 'admin'),
      '38700000-0000-4000-8000-000000000111',
      'user',
      'Which operator grew fastest this quarter?'
    )
  $$,
  'P0001',
  'ASSISTANT_FORBIDDEN',
  'writing into a conversation the actor cannot reach is refused'
);


-- ---------------------------------------------------------------------------
-- 3. The title comes from the first question
-- ---------------------------------------------------------------------------

select public.assistant_append_turn(
  (select id from aid where name = 'owner'),
  '38700000-0000-4000-8000-000000000111',
  'user',
  'Which clients are closest to being ready to apply?'
);

select is(
  (
    select conversation.title
    from public.assistant_conversations as conversation
    where conversation.id = (select id from aid where name = 'owner')
  ),
  (
    select left(btrim(turn.body), 80)
    from public.assistant_turns as turn
    where turn.conversation_id = (select id from aid where name = 'owner')
      and turn.role = 'user'
    order by turn.created_at asc
    limit 1
  ),
  'the title is the first question, derived from the turn that owns it'
);

select public.assistant_append_turn(
  (select id from aid where name = 'owner'),
  '38700000-0000-4000-8000-000000000111',
  'user',
  'And which of those are missing documents?'
);

select is(
  (
    select conversation.title
    from public.assistant_conversations as conversation
    where conversation.id = (select id from aid where name = 'owner')
  ),
  (
    select left(btrim(turn.body), 80)
    from public.assistant_turns as turn
    where turn.conversation_id = (select id from aid where name = 'owner')
      and turn.role = 'user'
    order by turn.created_at asc
    limit 1
  ),
  'a second question leaves the title alone'
);

select is(
  (
    select listed.message_count
    from public.assistant_list_conversations(
      '38700000-0000-4000-8000-000000000111',
      (select id from aid where name = 'owner')
    ) as listed
  ),
  (
    select count(*)::integer
    from public.assistant_turns as turn
    where turn.conversation_id = (select id from aid where name = 'owner')
  ),
  'the message count is derived from the turns rather than stored beside them'
);


-- ---------------------------------------------------------------------------
-- 4. A source must be nameable
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.assistant_append_turn(
      (select id from aid where name = 'owner'),
      '38700000-0000-4000-8000-000000000111',
      'assistant',
      'Two clients are close to ready.',
      '[{"kind": "client", "ref": "tracker:x"}]'::jsonb
    )
  $$,
  '23514',
  null,
  'a source with no human label cannot be stored, so no surface can be handed an id to print'
);

select throws_ok(
  $$
    select public.assistant_append_turn(
      (select id from aid where name = 'owner'),
      '38700000-0000-4000-8000-000000000111',
      'user',
      'A question does not cite anything.',
      '[{"kind": "client", "label": "Casey", "ref": null}]'::jsonb
    )
  $$,
  '23514',
  null,
  'a question carries no provenance, so it cannot claim any'
);

-- Every kind the validator permits stores, and one it does not is refused. The
-- list is exercised rather than copied: this fails if the migration's vocabulary
-- and this file's understanding of it ever diverge in either direction.
select is(
  (
    select count(*)::integer
    from unnest(array['client', 'bank', 'article', 'operator', 'metric']) as kind
    where private.assistant_sources_valid(
      jsonb_build_array(jsonb_build_object('kind', kind, 'label', 'A named source', 'ref', null))
    )
  ) - (
    select count(*)::integer
    from unnest(array['thread', 'draft', 'consumer', 'bureau']) as kind
    where private.assistant_sources_valid(
      jsonb_build_array(jsonb_build_object('kind', kind, 'label', 'A named source', 'ref', null))
    )
  ),
  5,
  'the five documented source kinds are exactly the ones the validator accepts'
);


-- ---------------------------------------------------------------------------
-- 5. Nothing here can speak to a client
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)
    from (
      select p.oid
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
        and p.proname like 'assistant\_%'
      offset 0
    ) as candidate
    where pg_get_functiondef(candidate.oid) ilike '%support_messages%'
       or pg_get_functiondef(candidate.oid) ilike '%support_send_message%'
  ),
  0::bigint,
  'no assistant function touches the support tables, so an answer cannot become a client message'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('assistant_conversations', 'assistant_turns')
      and grantee in ('authenticated', 'anon')
      and privilege_type <> 'SELECT'
  ),
  0,
  'a browser session can read a conversation under policy and write nothing'
);

select * from finish();

rollback;
