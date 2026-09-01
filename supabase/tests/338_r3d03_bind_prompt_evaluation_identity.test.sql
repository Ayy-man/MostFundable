-- R3D-03 — prompt activation requires the exact launch evaluation tuple.

create extension if not exists pgtap with schema extensions;
begin;
set local search_path = public, extensions;
select plan(12);

select has_column('public', 'eval_runs', 'reference_dataset_hash', 'evaluation evidence carries the dataset hash');
select has_column('public', 'eval_runs', 'driver', 'evaluation evidence carries the launch driver');
select has_column('public', 'eval_runs', 'model', 'evaluation evidence carries the launch model');
select col_not_null('public', 'eval_runs', 'reference_dataset_hash', 'dataset identity cannot be omitted');
select col_not_null('public', 'eval_runs', 'driver', 'driver identity cannot be omitted');
select col_not_null('public', 'eval_runs', 'model', 'model identity cannot be omitted');

insert into auth.users(id, email)
values ('33800000-0000-4000-8000-000000000001', 'admin@r3d03.test');
insert into public.profiles(id, role, full_name, email)
values ('33800000-0000-4000-8000-000000000001', 'platform_admin', 'R3D03 Admin', 'admin@r3d03.test')
on conflict(id) do update
set role = excluded.role, org_id = null, org_role = null, full_name = excluded.full_name, email = excluded.email;
insert into public.prompts(key, version, body, active, created_by, created_at) values
  ('funding-readiness-plan', 81, 'current active body', true, '33800000-0000-4000-8000-000000000001', '2026-08-17T00:00:00Z'),
  ('funding-readiness-plan', 82, 'identity-bound body', false, '33800000-0000-4000-8000-000000000001', '2026-08-17T00:10:00Z');

insert into public.eval_runs(
  prompt_key, prompt_version, evaluator_key, passed, result, policy_version, ran_at
) values
  ('funding-readiness-plan', 82, 'plan.supervisor', true, '{}', 'eval-policy-2026-08-17-r2', '2026-08-17T00:11:00Z'),
  ('funding-readiness-plan', 82, 'plan.deterministic', true, '{}', 'eval-policy-2026-08-17-r2', '2026-08-17T00:11:00Z');

select is(
  (select status from public.admin_activate_prompt_version(
    'funding-readiness-plan', 82, '33800000-0000-4000-8000-000000000001',
    'eval-policy-2026-08-17-r2',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'openrouter', 'openai/gpt-oss-20b'
  )),
  'held'::public.prompt_activation_status,
  'passing rows without launch identity cannot activate'
);
select is(
  (select active from public.prompts where key = 'funding-readiness-plan' and version = 82),
  false,
  'the staged prompt remains inactive after identity refusal'
);
select throws_ok(
  $$select * from public.admin_record_eval_run(
    'funding-readiness-plan', 82, 'plan.supervisor', true, '{}',
    'eval-policy-2026-08-17-r2',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'mock', 'template-v1', true, '33800000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'ADMIN_EVAL_IDENTITY_INVALID',
  'mock evidence cannot be recorded as activation eligible'
);

select * from public.admin_record_eval_run(
  'funding-readiness-plan', 82, 'plan.supervisor', true, '{}',
  'eval-policy-2026-08-17-r2',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'openrouter', 'openai/gpt-oss-20b', true, '33800000-0000-4000-8000-000000000001'
);
select * from public.admin_record_eval_run(
  'funding-readiness-plan', 82, 'plan.deterministic', true, '{}',
  'eval-policy-2026-08-17-r2',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'openrouter', 'openai/gpt-oss-20b', true, '33800000-0000-4000-8000-000000000001'
);

select is(
  (select status from public.admin_activate_prompt_version(
    'funding-readiness-plan', 82, '33800000-0000-4000-8000-000000000001',
    'eval-policy-2026-08-17-r2',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'openrouter', 'different-model'
  )),
  'held'::public.prompt_activation_status,
  'a different launch model cannot reuse passing evidence'
);
select is(
  (select status from public.admin_activate_prompt_version(
    'funding-readiness-plan', 82, '33800000-0000-4000-8000-000000000001',
    'eval-policy-2026-08-17-r2',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'openrouter', 'openai/gpt-oss-20b'
  )),
  'activated'::public.prompt_activation_status,
  'the exact current launch tuple can activate'
);
select is(
  (select count(distinct reference_dataset_hash || '|' || driver || '|' || model)::integer
   from public.eval_runs
   where prompt_key = 'funding-readiness-plan' and prompt_version = 82 and eligible),
  1,
  'eligible evidence shares one exact launch identity'
);

select * from finish();
rollback;
