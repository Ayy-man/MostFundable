-- Phase 13 · migration 103 — resolving a consumer's own client, and nothing more.
--
-- Migration 103 replaces one function to let a consumer open their team chat without naming a
-- client id. The risk in a replacement is not the change itself but everything around it, so this
-- file asserts the new behaviour in four cases and then re-asserts the three refusals migration
-- 101 already had, because a `create or replace` that quietly dropped one of them would otherwise
-- pass every test in the suite.

begin;

select plan(14);

insert into auth.users (id, email)
values
  ('13000000-0000-0000-0000-000000000900', 'platform@support.example'),
  ('13000000-0000-0000-0000-000000000111', 'owner.one@support.example'),
  ('13000000-0000-0000-0000-000000000113', 'consumer.one@support.example'),
  ('13000000-0000-0000-0000-000000000115', 'orphan.one@support.example'),
  ('14000000-0000-0000-0000-000000000221', 'owner.two@support.example'),
  ('14000000-0000-0000-0000-000000000222', 'consumer.two@support.example')
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
  ('13000000-0000-0000-0000-000000000113', 'consumer',
   '13000000-0000-0000-0000-000000000001', null,
   'Support Consumer One', 'consumer.one@support.example'),
  -- A consumer profile with no client row behind it. Rare, but it is the shape a half-finished
  -- enrollment leaves, and it must refuse rather than open a thread against a null client.
  ('13000000-0000-0000-0000-000000000115', 'consumer',
   '13000000-0000-0000-0000-000000000001', null,
   'Support Orphan One', 'orphan.one@support.example'),
  ('14000000-0000-0000-0000-000000000221', 'operator_member',
   '14000000-0000-0000-0000-000000000002', 'owner',
   'Support Owner Two', 'owner.two@support.example'),
  ('14000000-0000-0000-0000-000000000222', 'consumer',
   '14000000-0000-0000-0000-000000000002', null,
   'Support Consumer Two', 'consumer.two@support.example')
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
   '13000000-0000-0000-0000-000000000111'),
  ('14000000-0000-0000-0000-000000000202', '14000000-0000-0000-0000-000000000002',
   '14000000-0000-0000-0000-000000000222', 'Support Client Two',
   '14000000-0000-0000-0000-000000000221')
on conflict (id) do nothing;

create temp table sid (name text primary key, id uuid not null);


-- ---------------------------------------------------------------------------
-- 1. A consumer opens their own thread without naming a client.
-- ---------------------------------------------------------------------------

insert into sid (name, id)
select 'consumer_opened', (public.support_open_thread(
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  null,
  'Team Chat',
  '13000000-0000-0000-0000-000000000113'
)).id;

select is(
  (select thread.client_id from public.support_threads as thread
   where thread.id = (select id from sid where name = 'consumer_opened')),
  '13000000-0000-0000-0000-000000000101'::uuid,
  'the resolved client is the consumer''s own, not one they named'
);

select is(
  (select thread.created_by from public.support_threads as thread
   where thread.id = (select id from sid where name = 'consumer_opened')),
  '13000000-0000-0000-0000-000000000113'::uuid,
  'the consumer is recorded as having opened it'
);

-- The idempotency migration 101 established still holds across the two callers: the operator
-- asking for the same client's team chat gets the row the consumer created, not a second thread.
insert into sid (name, id)
select 'operator_opened', (public.support_open_thread(
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000101',
  'Client team chat',
  '13000000-0000-0000-0000-000000000111'
)).id;

select is(
  (select id from sid where name = 'operator_opened'),
  (select id from sid where name = 'consumer_opened'),
  'one client, one team chat, whichever side asks first'
);

select is(
  (select count(*) from public.support_threads
   where client_id = '13000000-0000-0000-0000-000000000101'),
  1::bigint,
  'and exactly one row exists for that client'
);

select is(
  (select count(*) from public.audit_log
   where subject_id = (select id from sid where name = 'consumer_opened')
     and action = 'support.thread_opened'),
  1::bigint,
  'the second open wrote no second audit row'
);


-- ---------------------------------------------------------------------------
-- 2. Resolution grants nothing.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.support_open_thread(
       'team_chat',
       '13000000-0000-0000-0000-000000000001',
       null,
       'Team Chat',
       '13000000-0000-0000-0000-000000000115'
     ) $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a consumer with no client row still cannot open a thread'
);

select throws_ok(
  $$ select public.support_open_thread(
       'team_chat',
       '13000000-0000-0000-0000-000000000001',
       null,
       'Client team chat',
       '13000000-0000-0000-0000-000000000111'
     ) $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'an operator still has to name the client — resolution is for consumers only'
);

select throws_ok(
  $$ select public.support_open_thread(
       'team_chat',
       '13000000-0000-0000-0000-000000000001',
       null,
       'Team Chat',
       '13000000-0000-0000-0000-000000000900'
     ) $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a platform admin has no client of their own to resolve either'
);

-- The consumer's own row is the only one reachable, so naming somebody else's changes nothing.
select throws_ok(
  $$ select public.support_open_thread(
       'team_chat',
       '14000000-0000-0000-0000-000000000002',
       '14000000-0000-0000-0000-000000000202',
       'Team Chat',
       '13000000-0000-0000-0000-000000000113'
     ) $$,
  'P0001',
  'SUPPORT_FORBIDDEN',
  'a consumer naming another org''s client is refused exactly as before'
);


-- ---------------------------------------------------------------------------
-- 3. Migration 101's other refusals survived the replacement.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.support_open_thread(
       'team_chat', '13000000-0000-0000-0000-000000000001',
       '13000000-0000-0000-0000-000000000101', 'Team Chat', null) $$,
  'P0001',
  'SUPPORT_ACTOR_REQUIRED',
  'a null actor is still refused'
);

select throws_ok(
  $$ select public.support_open_thread(
       'team_chat', '13000000-0000-0000-0000-000000000001',
       '13000000-0000-0000-0000-000000000101', 'Team Chat',
       '13000000-0000-0000-0000-0000000009ff') $$,
  'P0001',
  'SUPPORT_ACTOR_UNKNOWN',
  'an unknown actor is still refused'
);

select throws_ok(
  $$ select public.support_open_thread(
       'platform_support', '13000000-0000-0000-0000-000000000001',
       '13000000-0000-0000-0000-000000000101', 'Operator question',
       '13000000-0000-0000-0000-000000000111') $$,
  'P0001',
  'SUPPORT_THREAD_SCOPE_INVALID',
  'a platform thread carrying a client is still refused'
);


-- ---------------------------------------------------------------------------
-- 4. The replacement kept its hardening.
-- ---------------------------------------------------------------------------

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'support_open_thread'),
  'the replaced function is still security definer with an empty search path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.support_open_thread(public.support_thread_kind, uuid, uuid, text, uuid)',
    'execute'),
  'and is still not executable by authenticated'
);

select * from finish();

rollback;
