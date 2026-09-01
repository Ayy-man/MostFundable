begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R2D-04: evidence is post-prompt, exact-policy, and latest-result bound.
select plan(8);

insert into auth.users(id,email) values ('30000000-0000-4000-8000-000000000001','admin@r2d04.test');
insert into public.profiles(id,role,full_name,email) values
 ('30000000-0000-4000-8000-000000000001','platform_admin','R2D04 Admin','admin@r2d04.test')
on conflict(id) do update set role=excluded.role,org_id=null,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.prompts(key,version,body,active,created_by,created_at) values
 ('funding-readiness-plan',1,'active body',true,'30000000-0000-4000-8000-000000000001','2026-08-17T00:00:00Z'),
 ('funding-readiness-plan',2,'pre-prompt evidence',false,'30000000-0000-4000-8000-000000000001','2026-08-17T00:10:00Z'),
 ('funding-readiness-plan',3,'wrong policy',false,'30000000-0000-4000-8000-000000000001','2026-08-17T00:20:00Z'),
 ('funding-readiness-plan',4,'failed latest',false,'30000000-0000-4000-8000-000000000001','2026-08-17T00:30:00Z'),
 ('funding-readiness-plan',5,'current evidence',false,'30000000-0000-4000-8000-000000000001','2026-08-17T00:40:00Z');

select has_column('public','eval_runs','policy_version','evaluation evidence carries a policy version');
select col_not_null('public','eval_runs','policy_version','policy provenance cannot be omitted');

select * from public.admin_record_eval_run(
  'funding-readiness-plan',5,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2',
  'sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37',
  'openrouter','openai/gpt-oss-20b',true,'30000000-0000-4000-8000-000000000001'
);
select is((select policy_version from public.eval_runs where prompt_version=5 and evaluator_key='plan.supervisor'),'eval-policy-2026-08-17-r2','the recorder persists exact policy provenance');
select is((select count(*) from public.audit_log where action='admin.prompt.evaluated' and actor_profile_id='30000000-0000-4000-8000-000000000001'),1::bigint,'an admin evaluation is audited');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',2,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:09:00Z'),
 ('funding-readiness-plan',2,'plan.deterministic',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:09:00Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'30000000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'pre-prompt evidence cannot activate');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',3,'plan.supervisor',true,'{}','legacy-pre-r2d04','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:21:00Z'),
 ('funding-readiness-plan',3,'plan.deterministic',true,'{}','legacy-pre-r2d04','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:21:00Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',3,'30000000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'wrong-policy evidence cannot activate');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',4,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:31:00Z'),
 ('funding-readiness-plan',4,'plan.deterministic',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:31:00Z'),
 ('funding-readiness-plan',4,'plan.supervisor',false,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:32:00Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',4,'30000000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'a failed latest result supersedes earlier passing evidence');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',5,'plan.deterministic',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:41:00Z');
update public.eval_runs set ran_at='2026-08-17T00:41:00Z' where prompt_version=5 and evaluator_key='plan.supervisor';
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',5,'30000000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'activated'::public.prompt_activation_status,'exact current post-prompt evidence activates');

select * from finish();
rollback;
