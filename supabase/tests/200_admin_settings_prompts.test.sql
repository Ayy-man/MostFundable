begin;
set local search_path = public, extensions;
select plan(38);

select has_table('public', 'settings', 'settings table exists');
select has_table('public', 'prompts', 'prompts table exists');
select has_table('public', 'eval_runs', 'eval history table exists');
select has_function('public', 'admin_set_setting', array['text','jsonb','uuid'], 'setting RPC exists');
select has_function('public', 'admin_create_prompt_version', array['text','text','text','uuid'], 'prompt version RPC exists');
select has_function('public', 'admin_activate_prompt_version', array['text','integer','uuid','text','text','text','text'], 'prompt activation RPC exists');
select has_function('public', 'admin_record_eval_run', array['text','integer','text','boolean','jsonb','text','text','text','text','boolean','uuid'], 'eval record RPC exists');

select is((select count(*) from public.settings), 4::bigint, 'exactly four setting placeholders are seeded');
select is((select value from public.settings where key = 'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD'), '0.7'::jsonb, 'threshold seed is 0.7');
select is((select value from public.settings where key = 'TRIAL_DAYS'), '14'::jsonb, 'trial seed is 14');
select is((select value from public.settings where key = 'OPERATOR_GRACE_DAYS'), '7'::jsonb, 'grace seed is 7');
select is((select value from public.settings where key = 'FORCE_PULL_PRICE_CENTS'), '1900'::jsonb, 'force-pull seed is 1900');
select is(private.admin_setting_valid('FEATURE_ADMIN', '1'::jsonb), false, 'flags cannot be settings');
select is(private.admin_setting_valid('SUPPORT_DRAFT_CONFIDENCE_THRESHOLD', '0'::jsonb), false, 'zero threshold is refused');
select is(private.admin_setting_valid('TRIAL_DAYS', '1.5'::jsonb), false, 'day settings are integral');
select is(private.admin_setting_valid('FORCE_PULL_PRICE_CENTS', '100000001'::jsonb), false, 'price upper bound is enforced');

select is(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('settings','prompts','eval_runs')),
  true,
  'all governance tables enable and force RLS'
);
select is(has_table_privilege('authenticated', 'public.settings', 'insert'), false, 'authenticated cannot insert settings');
select is(has_table_privilege('authenticated', 'public.prompts', 'update'), false, 'authenticated cannot update prompts');
select is(has_table_privilege('service_role', 'public.eval_runs', 'insert'), false, 'service role records evals only through RPC');
select is(has_function_privilege('service_role', 'public.admin_set_setting(text,jsonb,uuid)', 'execute'), true, 'service role can execute setting RPC');
select is(has_function_privilege('authenticated', 'public.admin_set_setting(text,jsonb,uuid)', 'execute'), false, 'authenticated cannot execute setting RPC');
select has_index('public', 'prompts', 'prompts_one_active_per_key', 'one-active prompt index exists');

insert into auth.users (id, email) values
  ('23000000-0000-4000-8000-000000000001', 'admin@phase23.test'),
  ('23000000-0000-4000-8000-000000000002', 'member@phase23.test');
insert into public.orgs (id, name, slug) values
  ('23000000-0000-4000-8000-000000000010', 'Phase 23 Org', 'phase-23-org');
insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('23000000-0000-4000-8000-000000000001', 'platform_admin', null, null, 'Phase 23 Admin', 'admin@phase23.test'),
  ('23000000-0000-4000-8000-000000000002', 'operator_member', '23000000-0000-4000-8000-000000000010', 'owner', 'Phase 23 Member', 'member@phase23.test')
on conflict (id) do update set role=excluded.role, org_id=excluded.org_id, org_role=excluded.org_role, full_name=excluded.full_name, email=excluded.email;

select throws_ok(
  $$select * from public.admin_set_setting('TRIAL_DAYS', '30'::jsonb, '23000000-0000-4000-8000-000000000002')$$,
  'P0001', 'ADMIN_SETTING_ACTOR_FORBIDDEN', 'non-admin setting mutation is refused'
);
select lives_ok(
  $$select * from public.admin_set_setting('TRIAL_DAYS', '30'::jsonb, '23000000-0000-4000-8000-000000000001')$$,
  'platform admin can change a setting'
);
select is((select value from public.settings where key = 'TRIAL_DAYS'), '30'::jsonb, 'setting change persists');
select is(
  (select meta from public.audit_log where action = 'admin.setting.set' order by occurred_at desc limit 1),
  '{"from":"14","to":"30"}'::jsonb,
  'setting audit stores exact old and new JSON text'
);
select lives_ok(
  $$select * from public.admin_set_setting('TRIAL_DAYS', '30'::jsonb, '23000000-0000-4000-8000-000000000001')$$,
  'same-value setting replay succeeds'
);
select is((select count(*) from public.audit_log where action = 'admin.setting.set' and actor_profile_id = '23000000-0000-4000-8000-000000000001'), 1::bigint, 'same-value replay adds no audit row');

select lives_ok(
  $$select * from public.admin_record_eval_run('funding-readiness-plan', 1, 'deterministic', true, '{"rules":true}'::jsonb, 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b', true, null)$$,
  'embedded v1 evaluation persists while prompts are empty'
);
select is((select count(*) from public.prompts), 0::bigint, 'eval insertion does not materialize prompt content');
select lives_ok(
  $$select * from public.admin_create_prompt_version('funding-readiness-plan', 'edited body', 'embedded body', '23000000-0000-4000-8000-000000000001')$$,
  'first prompt edit materializes fallback and next version'
);
select results_eq(
  $$select version, active from public.prompts where key = 'funding-readiness-plan' order by version$$,
  $$values (1, true), (2, false)$$,
  'first edit stores active v1 and inactive v2'
);
select throws_ok(
  $$insert into public.prompts(key,version,body,active) values ('funding-readiness-plan',3,'third body',true)$$,
  '23505', null, 'duplicate active prompt is structurally refused'
);
select * from public.admin_record_eval_run('funding-readiness-plan', 2, 'plan.supervisor', true, '{"passed":true}'::jsonb, 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b', true, null);
select * from public.admin_record_eval_run('funding-readiness-plan', 2, 'plan.deterministic', true, '{"passed":true}'::jsonb, 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b', true, null);
select lives_ok(
  $$select * from public.admin_activate_prompt_version('funding-readiness-plan', 2, '23000000-0000-4000-8000-000000000001', 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b')$$,
  'new prompt version can be activated'
);
select is((select version from public.prompts where key = 'funding-readiness-plan' and active), 2, 'version 2 becomes active');
select * from public.admin_record_eval_run('funding-readiness-plan', 1, 'plan.supervisor', true, '{"passed":true}'::jsonb, 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b', true, null);
select * from public.admin_record_eval_run('funding-readiness-plan', 1, 'plan.deterministic', true, '{"passed":true}'::jsonb, 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b', true, null);
select lives_ok(
  $$select * from public.admin_activate_prompt_version('funding-readiness-plan', 1, '23000000-0000-4000-8000-000000000001', 'eval-policy-2026-08-17-r2', 'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37', 'openrouter', 'openai/gpt-oss-20b')$$,
  'stored v1 can be reactivated'
);
select is((select body from public.prompts where key = 'funding-readiness-plan' and version = 2), 'edited body', 'activation never rewrites body history');

select * from finish();
rollback;
