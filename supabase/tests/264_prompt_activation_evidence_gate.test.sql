begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1D-06: exact-version, latest, mandatory evaluator evidence gates activation.
select plan(8);

insert into auth.users(id,email) values ('26400000-0000-4000-8000-000000000001','admin@r1d06.test');
insert into public.profiles(id,role,full_name,email) values
 ('26400000-0000-4000-8000-000000000001','platform_admin','R1D06 Admin','admin@r1d06.test')
on conflict(id) do update set role=excluded.role,org_id=null,org_role=null,full_name=excluded.full_name,email=excluded.email;
insert into public.prompts(key,version,body,active,created_by,created_at) values
 ('funding-readiness-plan',1,'active body',true,'26400000-0000-4000-8000-000000000001','2026-08-17T00:00:00Z'),
 ('funding-readiness-plan',2,'candidate body',false,'26400000-0000-4000-8000-000000000001','2026-08-17T00:00:00Z');

select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'zero evidence returns a typed hold');
select is((select reason from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'evaluation_evidence_missing'::public.prompt_activation_hold_reason,'hold carries the bounded reason');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',1,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:01Z'),
 ('funding-readiness-plan',1,'plan.deterministic',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:01Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'wrong-version evidence does not release the hold');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',2,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:02Z'),
 ('funding-readiness-plan',2,'plan.deterministic',false,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:02Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'failed evidence holds activation');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at) values
 ('funding-readiness-plan',2,'plan.deterministic',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:03Z'),
 ('funding-readiness-plan',2,'plan.supervisor',false,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:03Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'held'::public.prompt_activation_status,'a later failure makes earlier passing evidence stale');

insert into public.eval_runs(prompt_key,prompt_version,evaluator_key,passed,result,policy_version,reference_dataset_hash,driver,model,eligible,ran_at)
values('funding-readiness-plan',2,'plan.supervisor',true,'{}','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b',true,'2026-08-17T00:00:04Z');
select is((select status from public.admin_activate_prompt_version('funding-readiness-plan',2,'26400000-0000-4000-8000-000000000001','eval-policy-2026-08-17-r2','sha256:a8d80f919222c14896481df0582df4429b56101aea91161cdfc76662db885e37','openrouter','openai/gpt-oss-20b')),'activated'::public.prompt_activation_status,'current passing mandatory evidence activates');
select is((select version from public.prompts where key='funding-readiness-plan' and active),2,'only the evidenced version becomes active');
select is((select count(*) from public.audit_log where action='admin.prompt.activated' and actor_profile_id='26400000-0000-4000-8000-000000000001'),1::bigint,'holds add no activation audit and success adds one');

select * from finish();
rollback;
