-- 391_consumer_checklist_reporting.test.sql — the consumer Optimization write path.
--
-- Watched failing against the pre-migration tree (ledger head 390): every
-- assertion errored with
-- `function public.report_checklist_item(unknown, unknown) does not exist`,
-- and the two grant assertions returned NULL because there was no pg_proc row
-- to explode an ACL from.
--
-- Nothing below transcribes a number, an id or a grant from the reproduction.
-- The two reportable template ids are looked up from public.checklist_templates
-- by key, so a re-seed that moves them moves the test with them; the grant
-- assertion derives the whole EXECUTE grantee set from pg_proc.proacl rather
-- than checking the one grantee the migration happens to name, so a second
-- grant added later fails here instead of passing unnoticed; and the
-- "not reportable" case asserts the template EXISTS before asserting the
-- refusal, so it can never pass for the uninteresting reason.

begin;

set local search_path = public, extensions;

select plan(22);


-- ---------------------------------------------------------------------------
-- Fixtures: one org, two consumers with a client each, one operator.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('39100000-0000-4000-8000-000000000111', 'report.one@optimization.example'),
  ('39100000-0000-4000-8000-000000000112', 'report.two@optimization.example'),
  ('39100000-0000-4000-8000-000000000113', 'report.owner@optimization.example');

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('39100000-0000-4000-8000-000000000001', 'Reporting Org', 'reporting-org', true);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    '39100000-0000-4000-8000-000000000111',
    'consumer',
    '39100000-0000-4000-8000-000000000001',
    null,
    'Reporting Consumer One',
    'report.one@optimization.example'
  ),
  (
    '39100000-0000-4000-8000-000000000112',
    'consumer',
    '39100000-0000-4000-8000-000000000001',
    null,
    'Reporting Consumer Two',
    'report.two@optimization.example'
  ),
  (
    '39100000-0000-4000-8000-000000000113',
    'operator_member',
    '39100000-0000-4000-8000-000000000001',
    'owner',
    'Reporting Owner',
    'report.owner@optimization.example'
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
    '39100000-0000-4000-8000-000000000101',
    '39100000-0000-4000-8000-000000000001',
    '39100000-0000-4000-8000-000000000111',
    'Reporting Client One',
    '39100000-0000-4000-8000-000000000113'
  ),
  (
    '39100000-0000-4000-8000-000000000102',
    '39100000-0000-4000-8000-000000000001',
    '39100000-0000-4000-8000-000000000112',
    'Reporting Client Two',
    '39100000-0000-4000-8000-000000000113'
  );

-- A template that exists and is deliberately not on the allow-list. The point of
-- the case below is that the refusal is about the list, not about the row.
insert into public.checklist_templates (id, kind, key, title, blocking, sort_order)
values (
  '39100000-0000-4000-8000-000000000201',
  'personal_credit',
  'lane-391-not-reportable',
  'A template a consumer may not report',
  false,
  910
);


-- ---------------------------------------------------------------------------
-- 1. Shape and grants
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'report_checklist_item',
  array['text', 'text'],
  'the consumer reporting entry point exists'
);

select is(
  (
    select array_agg(distinct grantee.rolname::text order by grantee.rolname::text)
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(proc.proacl) as acl
    join pg_roles as grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'public'
      and proc.proname = 'report_checklist_item'
      and acl.privilege_type = 'EXECUTE'
      and grantee.oid <> proc.proowner
  ),
  array['authenticated'],
  'exactly one role beyond the owner may execute the reporting function'
);

select is(
  has_function_privilege('anon', 'public.report_checklist_item(text, text)', 'execute'),
  false,
  'an anonymous session cannot execute the reporting function'
);


-- ---------------------------------------------------------------------------
-- 2. A consumer reports their own factor, and can walk it back
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39100000-0000-4000-8000-000000000111"}';

select is(
  (select state::text from public.report_checklist_item('utilization-under-thirty', 'report')),
  'reported',
  'a consumer moves their own utilization factor from todo to reported'
);

select is(
  (
    select count(*)::integer
    from public.checklist_items as item
    where item.client_id = '39100000-0000-4000-8000-000000000101'
      and item.template_id = (
        select template.id
        from public.checklist_templates as template
        where template.key = 'utilization-under-thirty'
      )
  ),
  1,
  'reporting materialises the checklist item from its template when the client had none'
);

select isnt(
  (
    select item_state.reported_at
    from public.checklist_item_state as item_state
    where item_state.client_id = '39100000-0000-4000-8000-000000000101'
      and item_state.checklist_item_id = (
        select item.id
        from public.checklist_items as item
        where item.client_id = '39100000-0000-4000-8000-000000000101'
          and item.template_id = (
            select template.id
            from public.checklist_templates as template
            where template.key = 'utilization-under-thirty'
          )
      )
  ),
  null,
  'the report stamps the row column the table already keeps for it'
);

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'report')$$,
  'P0001',
  'CHECKLIST_TRANSITION_FORBIDDEN',
  'a second report on an already reported factor is refused rather than restamped'
);

select is(
  (select state::text from public.report_checklist_item('utilization-under-thirty', 'undo')),
  'todo',
  'the consumer can walk their own report back'
);

select is(
  (
    select item_state.reported_at
    from public.checklist_item_state as item_state
    where item_state.client_id = '39100000-0000-4000-8000-000000000101'
      and item_state.state = 'todo'
  ),
  null,
  'undo clears the timestamp, because a todo row is forbidden to carry one'
);

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'undo')$$,
  'P0001',
  'CHECKLIST_TRANSITION_FORBIDDEN',
  'there is nothing to undo once the row is back at todo'
);

select is(
  (select state::text from public.report_checklist_item('business-profile-complete', 'report')),
  'reported',
  'the business rollup template is reportable on the same terms'
);


-- ---------------------------------------------------------------------------
-- 3. The allow-list, and the action vocabulary
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from public.checklist_templates as template
    where template.key = 'lane-391-not-reportable'
  ),
  1,
  'the not-reportable template really is in the catalog, so the refusal below is about the list'
);

select throws_ok(
  $$select public.report_checklist_item('lane-391-not-reportable', 'report')$$,
  '22023',
  'CHECKLIST_TEMPLATE_NOT_REPORTABLE',
  'a template outside the hard-coded allow-list cannot be reported by a consumer'
);

select throws_ok(
  $$select public.report_checklist_item('no-such-template-key', 'report')$$,
  '22023',
  'CHECKLIST_TEMPLATE_NOT_REPORTABLE',
  'an unknown key is refused by the allow-list before anything is looked up'
);

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'verify')$$,
  '22023',
  'CHECKLIST_ACTION_INVALID',
  'the only two actions are report and undo'
);


-- ---------------------------------------------------------------------------
-- 4. The pipeline's words are not the consumer's to edit
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', null, true);

update public.checklist_item_state
set state = 'verifying',
    reported_at = now() - interval '2 hours',
    verifying_at = now() - interval '1 hour'
where client_id = '39100000-0000-4000-8000-000000000101'
  and checklist_item_id = (
    select item.id
    from public.checklist_items as item
    where item.client_id = '39100000-0000-4000-8000-000000000101'
      and item.template_id = (
        select template.id
        from public.checklist_templates as template
        where template.key = 'utilization-under-thirty'
      )
  );

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39100000-0000-4000-8000-000000000111"}';

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'report')$$,
  'P0001',
  'CHECKLIST_TRANSITION_FORBIDDEN',
  'a factor the pipeline is verifying cannot be re-reported'
);

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'undo')$$,
  'P0001',
  'CHECKLIST_TRANSITION_FORBIDDEN',
  'a factor the pipeline is verifying cannot be un-reported'
);


-- ---------------------------------------------------------------------------
-- 5. Another consumer reaches their own record and only their own
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39100000-0000-4000-8000-000000000112"}';

select is(
  (
    select item_state.client_id
    from public.report_checklist_item('utilization-under-thirty', 'report') as item_state
  ),
  '39100000-0000-4000-8000-000000000102'::uuid,
  'the client is resolved from the caller, so a consumer can only ever write to their own record'
);

select is(
  (
    select count(*)::integer
    from public.checklist_item_state as item_state
    where item_state.client_id = '39100000-0000-4000-8000-000000000101'
  ),
  0,
  'the second consumer''s own session cannot even see the first consumer''s state row'
);

-- Read back as the owner rather than as the caller: the claim is about what is
-- STORED, and asking the second consumer would only re-measure the RLS
-- predicate the assertion above already covers.
reset role;
select set_config('request.jwt.claims', null, true);

select is(
  (
    select item_state.state::text
    from public.checklist_item_state as item_state
    where item_state.client_id = '39100000-0000-4000-8000-000000000101'
      and item_state.checklist_item_id = (
        select item.id
        from public.checklist_items as item
        where item.client_id = '39100000-0000-4000-8000-000000000101'
          and item.template_id = (
            select template.id
            from public.checklist_templates as template
            where template.key = 'utilization-under-thirty'
          )
      )
  ),
  'verifying',
  'the other consumer''s row is exactly where the pipeline left it'
);


-- ---------------------------------------------------------------------------
-- 6. Nobody else gets in
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"39100000-0000-4000-8000-000000000113"}';

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'report')$$,
  '42501',
  'CHECKLIST_FORBIDDEN',
  'an operator session cannot report on a consumer''s behalf through this path'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$select public.report_checklist_item('utilization-under-thirty', 'report')$$,
  '42501',
  'permission denied for function report_checklist_item',
  'an anonymous session is refused by the grant, before any of the checks run'
);

reset role;
select set_config('request.jwt.claims', null, true);

select * from finish();

rollback;
