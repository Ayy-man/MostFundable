-- 100_support_threads.test.sql — Phase 13 (S2.5).
--
-- Proves the structural half of SUPP-01, SUPP-02, and SUPP-04 with no
-- application code running: the closed author vocabulary, the empty write-grant
-- set, every matched constraint pair in both directions, the two partial unique
-- indexes, the composite tenancy foreign key, the two integrity triggers, and
-- the per-profile access predicate.

begin;

set local search_path = public, extensions;

select plan(107);


-- ---------------------------------------------------------------------------
-- Fixtures
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


-- ---------------------------------------------------------------------------
-- 1. Objects exist
-- ---------------------------------------------------------------------------

select has_table('public', 'support_threads', 'support threads table exists');
select has_table('public', 'held_drafts', 'held drafts table exists');
select has_table('public', 'support_messages', 'support messages table exists');
select has_type('public', 'support_thread_kind', 'thread kind type exists');
select has_type('public', 'support_thread_status', 'thread status type exists');
select has_type('public', 'support_author_kind', 'author kind type exists');
select has_type('public', 'support_message_origin', 'message origin type exists');
select has_type('public', 'held_draft_status', 'held draft status type exists');


-- ---------------------------------------------------------------------------
-- 2. The closed vocabularies
-- ---------------------------------------------------------------------------

select enum_has_labels(
  'public',
  'support_thread_kind',
  array['team_chat', 'platform_support'],
  'thread kind carries the two documented shapes'
);

select enum_has_labels(
  'public',
  'support_thread_status',
  array['open', 'pending', 'resolved'],
  'thread status carries the three documented states'
);

select enum_has_labels(
  'public',
  'support_author_kind',
  array['consumer', 'operator', 'admin'],
  'author kind carries exactly the three human authors'
);

select is(
  (
    select count(*)::integer
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'support_author_kind'
  ),
  3,
  'author kind has exactly three values, so widening it is a visible migration'
);

select is(
  (
    select count(*)::integer
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'support_author_kind'
      and pg_enum.enumlabel in ('ai', 'assistant', 'bot', 'kb_bot', 'system', 'machine')
  ),
  0,
  'author kind carries no non-human value'
);

select enum_has_labels(
  'public',
  'support_message_origin',
  array['human', 'ai_assisted'],
  'message origin distinguishes a plain send from an assisted one'
);

select enum_has_labels(
  'public',
  'held_draft_status',
  array['draft', 'approved', 'sent', 'discarded'],
  'held draft status carries the four documented states'
);


-- ---------------------------------------------------------------------------
-- 3. Column shape
-- ---------------------------------------------------------------------------

select columns_are(
  'public',
  'support_threads',
  array[
    'id',
    'kind',
    'org_id',
    'client_id',
    'status',
    'subject',
    'created_by',
    'created_at',
    'last_activity_at'
  ],
  'thread table exposes the exact column list'
);

select columns_are(
  'public',
  'held_drafts',
  array[
    'id',
    'thread_id',
    'body',
    'confidence',
    'confidence_threshold',
    'supervisor_approved',
    'guardrail_flags',
    'status',
    'driver',
    'model',
    'prompt_key',
    'prompt_version',
    'created_at',
    'sent_by',
    'sent_at',
    'sent_message_id',
    'discarded_by',
    'discarded_at'
  ],
  'held draft table carries the full audit record on the row'
);

select columns_are(
  'public',
  'support_messages',
  array[
    'id',
    'thread_id',
    'author_profile_id',
    'author_kind',
    'origin',
    'origin_draft_id',
    'body',
    'sent_at',
    -- Added by migration 385. The list is exhaustive on purpose, so a column
    -- arriving on this table is a line somebody wrote here rather than a change
    -- nobody noticed; `visibility` is that line.
    'visibility'
  ],
  'message table exposes the exact column list'
);

select col_not_null('public', 'support_messages', 'thread_id', 'a message always names its thread');
select col_not_null('public', 'support_messages', 'author_profile_id', 'a message always names a person');
select col_not_null('public', 'support_messages', 'author_kind', 'a message always declares its author kind');
select col_not_null('public', 'support_messages', 'body', 'a message always carries a body');
select col_type_is('public', 'held_drafts', 'confidence_threshold', 'numeric(4,3)', 'the applied bar is stored on the row');
select col_type_is('public', 'held_drafts', 'guardrail_flags', 'text[]', 'guardrail codes are stored verbatim');


-- ---------------------------------------------------------------------------
-- 4. The grant set — the absence is the mechanism
-- ---------------------------------------------------------------------------

select ok(has_table_privilege('authenticated', 'public.support_threads', 'select'), 'signed-in readers may select threads');
select ok(has_table_privilege('authenticated', 'public.support_messages', 'select'), 'signed-in readers may select messages');
select ok(has_table_privilege('authenticated', 'public.held_drafts', 'select'), 'signed-in readers may select drafts under policy');

select ok(not has_table_privilege('authenticated', 'public.support_threads', 'insert'), 'signed-in sessions cannot insert threads');
select ok(not has_table_privilege('authenticated', 'public.support_threads', 'update'), 'signed-in sessions cannot update threads');
select ok(not has_table_privilege('authenticated', 'public.support_threads', 'delete'), 'signed-in sessions cannot delete threads');
select ok(not has_table_privilege('authenticated', 'public.support_messages', 'insert'), 'signed-in sessions cannot insert messages');
select ok(not has_table_privilege('authenticated', 'public.support_messages', 'update'), 'signed-in sessions cannot update messages');
select ok(not has_table_privilege('authenticated', 'public.support_messages', 'delete'), 'signed-in sessions cannot delete messages');
select ok(not has_table_privilege('authenticated', 'public.held_drafts', 'insert'), 'signed-in sessions cannot insert drafts');
select ok(not has_table_privilege('authenticated', 'public.held_drafts', 'update'), 'signed-in sessions cannot update drafts');
select ok(not has_table_privilege('authenticated', 'public.held_drafts', 'delete'), 'signed-in sessions cannot delete drafts');

select ok(not has_table_privilege('anon', 'public.support_threads', 'select'), 'anonymous callers cannot read threads');
select ok(not has_table_privilege('anon', 'public.support_messages', 'select'), 'anonymous callers cannot read messages');
select ok(not has_table_privilege('anon', 'public.held_drafts', 'select'), 'anonymous callers cannot read drafts');

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('support_threads', 'support_messages', 'held_drafts')
      and relation.relrowsecurity
  ),
  3,
  'all three support tables enable row security'
);

select is(
  (
    select count(*)::integer
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('support_threads', 'support_messages', 'held_drafts')
      and relation.relforcerowsecurity
  ),
  3,
  'all three support tables force row security'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in ('support_threads', 'support_messages', 'held_drafts')
  ),
  3,
  'the support tables carry exactly three policies'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in ('support_threads', 'support_messages', 'held_drafts')
      and cmd <> 'SELECT'
  ),
  0,
  'every support policy is a read policy, because there is no write grant to police'
);


-- ---------------------------------------------------------------------------
-- 5. Thread constraints
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.support_threads (id, kind, org_id, client_id, subject, created_by)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Team thread one',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'a team chat thread naming its client inserts'
);

select lives_ok(
  $$
    insert into public.support_threads (id, kind, org_id, subject, created_by)
    values (
      '13000000-0000-0000-0000-00000000aa02',
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      'Platform thread one',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'a platform support thread without a client inserts'
);

select throws_matching(
  $$
    insert into public.support_threads (kind, org_id, subject, created_by)
    values (
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      'Team thread without a client',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'support_threads_kind_scope',
  'a team chat thread without a client is refused'
);

select throws_matching(
  $$
    insert into public.support_threads (kind, org_id, client_id, subject, created_by)
    values (
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Platform thread with a client',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'support_threads_kind_scope',
  'a platform support thread naming a client is refused'
);

select throws_matching(
  $$
    insert into public.support_threads (kind, org_id, client_id, subject, created_by)
    values (
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000202',
      'Cross tenant thread',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'support_threads_client_org_fk',
  'a thread cannot point at a client in another organization'
);

select throws_matching(
  $$
    insert into public.support_threads (kind, org_id, client_id, subject, created_by)
    values (
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      '   ',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'support_threads_subject_length',
  'a blank subject is refused'
);

select throws_matching(
  $$
    insert into public.support_threads (kind, org_id, client_id, subject, created_by)
    values (
      'team_chat',
      '13000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000101',
      'Second team thread',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'support_threads_one_team_chat_per_client',
  'a client has at most one team chat thread'
);

select lives_ok(
  $$
    insert into public.support_threads (kind, org_id, subject, created_by)
    values (
      'platform_support',
      '13000000-0000-0000-0000-000000000001',
      'Platform thread two',
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'an organization may hold more than one platform support thread'
);


-- ---------------------------------------------------------------------------
-- 6. Held draft constraints
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.held_drafts (
      id, thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000dd01',
      '13000000-0000-0000-0000-00000000aa01',
      'A drafted reply awaiting a person.',
      0.860, 0.700, true, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'a draft clearing all three gates may be approved'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, guardrail_flags, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true,
      array['lower_case_code'], 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_flag_shape',
  'a guardrail code outside the documented shape is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, guardrail_flags, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true,
      (select array_agg('LANGUAGE_C' || lpad(n::text, 2, '0')) from generate_series(1, 33) as n),
      'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_flag_count',
  'more than thirty-two guardrail codes is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, false, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_gates_for_approval',
  'an approved draft without the supervisor pass is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, guardrail_flags, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true,
      array['LANGUAGE_C01'], 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_gates_for_approval',
  'an approved draft carrying a guardrail code is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.400, 0.700, true, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_gates_for_approval',
  'an approved draft below the applied bar is refused'
);

select lives_ok(
  $$
    insert into public.held_drafts (
      id, thread_id, body, confidence, confidence_threshold,
      supervisor_approved, guardrail_flags, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000dd02',
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply that a person can read but nobody can send.',
      0.400, 0.700, true, array['LANGUAGE_C01'], 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'a draft failing the gates is still persisted, it is simply not sendable'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version,
      sent_at, sent_message_id
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'sent', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      now(), '13000000-0000-0000-0000-00000000ee99'
    )
  $$,
  'held_drafts_send_requires_human',
  'a sent draft without a named sender is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version,
      sent_by, sent_message_id
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'sent', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000111', '13000000-0000-0000-0000-00000000ee99'
    )
  $$,
  'held_drafts_send_requires_human',
  'a sent draft without a send timestamp is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version,
      sent_by, sent_at
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'sent', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000111', now()
    )
  $$,
  'held_drafts_send_requires_human',
  'a sent draft naming no message is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version, sent_by
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'held_drafts_unsent_is_clean',
  'an unsent draft cannot carry send attribution'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version, discarded_at
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'discarded', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      now()
    )
  $$,
  'held_drafts_discard_requires_actor',
  'a discarded draft without a named actor is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version, discarded_by
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1,
      '13000000-0000-0000-0000-000000000111'
    )
  $$,
  'held_drafts_undiscarded_is_clean',
  'a live draft cannot carry discard attribution'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'draft', 'someone_else', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_driver_check',
  'an unknown driver name is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'other-prompt', 1
    )
  $$,
  'held_drafts_prompt_key_check',
  'a draft row from another prompt family is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      '   ', 0.860, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_body_length',
  'a blank draft body is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 1.500, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_confidence_range',
  'a confidence outside the unit interval is refused'
);

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa02',
      'A drafted reply.', 0.860, 1.500, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_threshold_range',
  'an applied bar outside the unit interval is refused'
);


-- ---------------------------------------------------------------------------
-- 7. One open draft per thread
-- ---------------------------------------------------------------------------

select throws_matching(
  $$
    insert into public.held_drafts (
      thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000aa01',
      'A second open draft.', 0.860, 0.700, true, 'draft', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'held_drafts_one_open_per_thread',
  'a thread cannot hold two open drafts, so a cross-thread queue is unrepresentable'
);

update public.held_drafts
set status = 'discarded',
    discarded_by = '13000000-0000-0000-0000-000000000111',
    discarded_at = now()
where id = '13000000-0000-0000-0000-00000000dd01';

select lives_ok(
  $$
    insert into public.held_drafts (
      id, thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000dd03',
      '13000000-0000-0000-0000-00000000aa01',
      'A fresh draft after the first was set aside.',
      0.860, 0.700, true, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'a new draft opens once the previous one is closed out'
);


-- ---------------------------------------------------------------------------
-- 8. Message constraints and the author trigger
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.support_messages (id, thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000ee01',
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000113',
      'consumer',
      'A first question from the client contact.'
    )
  $$,
  'a consumer profile may author a consumer message'
);

select lives_ok(
  $$
    insert into public.support_messages (id, thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000ee02',
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'A reply from the account team.'
    )
  $$,
  'an operator profile may author an operator message'
);

select lives_ok(
  $$
    insert into public.support_messages (id, thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000ee03',
      '13000000-0000-0000-0000-00000000aa02',
      '13000000-0000-0000-0000-000000000900',
      'admin',
      'A reply from the platform team.'
    )
  $$,
  'a platform admin profile may author an admin message'
);

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000113',
      'operator',
      'A message claiming the wrong author kind.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'a consumer profile cannot author an operator message'
);

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'admin',
      'A message claiming the wrong author kind.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'an operator profile cannot author an admin message'
);

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa02',
      '13000000-0000-0000-0000-000000000900',
      'consumer',
      'A message claiming the wrong author kind.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'a platform admin profile cannot author a consumer message'
);

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000114',
      'consumer',
      'A message from a referral partner profile.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'a referral partner profile matches no author kind, first direction'
);

select throws_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000114',
      'operator',
      'A message from a referral partner profile.'
    )
  $$,
  'P0001',
  'SUPPORT_AUTHOR_ROLE_MISMATCH',
  'a referral partner profile matches no author kind, second direction'
);

select throws_matching(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, origin, origin_draft_id, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'human',
      '13000000-0000-0000-0000-00000000dd03',
      'A plain message pointing at a draft.'
    )
  $$,
  'support_messages_origin_pairing',
  'a plain message cannot claim a draft'
);

select throws_matching(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, origin, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'ai_assisted',
      'An assisted message naming no draft.'
    )
  $$,
  'support_messages_origin_pairing',
  'an assisted message must name the draft it came from'
);

select throws_matching(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'operator',
      '   '
    )
  $$,
  'support_messages_body_length',
  'a blank message body is refused'
);

select lives_ok(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, body)
    values
      ('13000000-0000-0000-0000-00000000aa01', '13000000-0000-0000-0000-000000000111', 'operator', 'Another plain reply.'),
      ('13000000-0000-0000-0000-00000000aa01', '13000000-0000-0000-0000-000000000111', 'operator', 'And another plain reply.')
  $$,
  'many plain messages coexist because the draft pointer is null-distinct'
);


-- ---------------------------------------------------------------------------
-- 9. The draft/message pairing trigger
-- ---------------------------------------------------------------------------

insert into public.support_messages (id, thread_id, author_profile_id, author_kind, origin, origin_draft_id, body)
values (
  '13000000-0000-0000-0000-00000000ee10',
  '13000000-0000-0000-0000-00000000aa01',
  '13000000-0000-0000-0000-000000000111',
  'operator',
  'ai_assisted',
  '13000000-0000-0000-0000-00000000dd03',
  'A fresh draft after the first was set aside.'
);

select throws_matching(
  $$
    insert into public.support_messages (thread_id, author_profile_id, author_kind, origin, origin_draft_id, body)
    values (
      '13000000-0000-0000-0000-00000000aa01',
      '13000000-0000-0000-0000-000000000111',
      'operator',
      'ai_assisted',
      '13000000-0000-0000-0000-00000000dd03',
      'A second message claiming the same draft.'
    )
  $$,
  'support_messages_origin_draft_unique',
  'two messages cannot claim one draft'
);

select lives_ok(
  $$
    update public.held_drafts
    set status = 'sent',
        sent_by = '13000000-0000-0000-0000-000000000111',
        sent_at = now(),
        sent_message_id = '13000000-0000-0000-0000-00000000ee10'
    where id = '13000000-0000-0000-0000-00000000dd03'
  $$,
  'a draft pairs with the message that points back at it'
);

select lives_ok(
  $$
    insert into public.held_drafts (
      id, thread_id, body, confidence, confidence_threshold,
      supervisor_approved, status, driver, model, prompt_key, prompt_version
    ) values (
      '13000000-0000-0000-0000-00000000dd04',
      '13000000-0000-0000-0000-00000000aa01',
      'Another approved draft on the same thread.',
      0.900, 0.700, true, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
    )
  $$,
  'a new draft opens once the previous one has been sent'
);

insert into public.support_messages (id, thread_id, author_profile_id, author_kind, origin, origin_draft_id, body)
values (
  '13000000-0000-0000-0000-00000000ee11',
  '13000000-0000-0000-0000-00000000aa01',
  '13000000-0000-0000-0000-000000000111',
  'operator',
  'ai_assisted',
  '13000000-0000-0000-0000-00000000dd04',
  'Another approved draft on the same thread.'
);

update public.held_drafts
set status = 'sent',
    sent_by = '13000000-0000-0000-0000-000000000111',
    sent_at = now(),
    sent_message_id = '13000000-0000-0000-0000-00000000ee11'
where id = '13000000-0000-0000-0000-00000000dd04';

select is(
  (
    select count(*)::integer
    from public.held_drafts
    where thread_id = '13000000-0000-0000-0000-00000000aa01'
      and status = 'sent'
  ),
  2,
  'two sent drafts coexist on one thread because the index is partial'
);

insert into public.held_drafts (
  id, thread_id, body, confidence, confidence_threshold,
  supervisor_approved, status, driver, model, prompt_key, prompt_version
) values (
  '13000000-0000-0000-0000-00000000dd05',
  '13000000-0000-0000-0000-00000000aa01',
  'A draft used only to probe the pairing trigger.',
  0.900, 0.700, true, 'approved', 'mock', 'support-draft-mock-v1', 'support-draft', 1
);

select throws_ok(
  $$
    update public.held_drafts
    set status = 'sent',
        sent_by = '13000000-0000-0000-0000-000000000111',
        sent_at = now(),
        sent_message_id = '13000000-0000-0000-0000-00000000ee03'
    where id = '13000000-0000-0000-0000-00000000dd05'
  $$,
  'P0001',
  'SUPPORT_DRAFT_PAIRING_INVALID',
  'a draft cannot pair with a message on another thread'
);

select throws_ok(
  $$
    update public.held_drafts
    set status = 'sent',
        sent_by = '13000000-0000-0000-0000-000000000111',
        sent_at = now(),
        sent_message_id = '13000000-0000-0000-0000-00000000ee01'
    where id = '13000000-0000-0000-0000-00000000dd05'
  $$,
  'P0001',
  'SUPPORT_DRAFT_PAIRING_INVALID',
  'a draft cannot pair with a plain message that names no draft'
);


-- ---------------------------------------------------------------------------
-- 10. The cascade pair
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ delete from public.support_threads where id = '13000000-0000-0000-0000-00000000aa01' $$,
  'deleting a thread removes its messages and drafts in one statement'
);

select is(
  (
    select count(*)::integer
    from public.support_messages
    where thread_id = '13000000-0000-0000-0000-00000000aa01'
  ),
  0,
  'no message survives its thread'
);

select is(
  (
    select count(*)::integer
    from public.held_drafts
    where thread_id = '13000000-0000-0000-0000-00000000aa01'
  ),
  0,
  'no draft survives its thread'
);


-- ---------------------------------------------------------------------------
-- 11. The access predicate matrix
-- ---------------------------------------------------------------------------
--
-- Org One sets team_sees_all_clients false, so operator access turns on the
-- assignment and org-role rules rather than on a blanket organization setting.

insert into public.support_threads (id, kind, org_id, client_id, subject, created_by)
values (
  '13000000-0000-0000-0000-00000000bb01',
  'team_chat',
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000101',
  'Access matrix team thread',
  '13000000-0000-0000-0000-000000000111'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000113',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'the client contact reads their own team thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '14000000-0000-0000-0000-000000000222',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'a contact in another organization does not read the team thread'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000111',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'the assigned operator owner reads the team thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000112',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'an unassigned specialist in the same organization does not read the team thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '14000000-0000-0000-0000-000000000221',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'an operator in another organization does not read the team thread'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000900',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'the platform admin reads the team thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000114',
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'a referral partner does not read the team thread'
);

select ok(
  not private.profile_can_access_support_thread(
    null,
    '13000000-0000-0000-0000-00000000bb01'
  ),
  'an absent profile reads nothing'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000900',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'the platform admin reads a platform support thread'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000111',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'an operator in the thread organization reads its platform support thread'
);

select ok(
  private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000112',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'any operator in the thread organization reads its platform support thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '14000000-0000-0000-0000-000000000221',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'an operator in another organization does not read the platform support thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000113',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'a client contact does not read a platform support thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000114',
    '13000000-0000-0000-0000-00000000aa02'
  ),
  'a referral partner does not read a platform support thread'
);

select ok(
  not private.profile_can_access_support_thread(
    '13000000-0000-0000-0000-000000000900',
    '13000000-0000-0000-0000-00000000ffff'
  ),
  'a thread that does not exist grants nothing, even to the platform admin'
);

select * from finish();

rollback;
