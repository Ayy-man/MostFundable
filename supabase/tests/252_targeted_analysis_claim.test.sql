begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-05: targeted claims never consume a neighbouring client's job.
select plan(12);

insert into auth.users(id, email) values
  ('25200000-0000-4000-8000-000000000011', 'owner.one@r1c05.example'),
  ('25200000-0000-4000-8000-000000000012', 'consumer.one@r1c05.example'),
  ('25200000-0000-4000-8000-000000000021', 'owner.two@r1c05.example'),
  ('25200000-0000-4000-8000-000000000022', 'consumer.two@r1c05.example');

insert into public.orgs(id, name, slug) values
  ('25200000-0000-4000-8000-000000000001', 'R1C05 One', 'r1c05-one'),
  ('25200000-0000-4000-8000-000000000002', 'R1C05 Two', 'r1c05-two');

insert into public.profiles(id, role, org_id, org_role, full_name, email) values
  ('25200000-0000-4000-8000-000000000011', 'operator_member', '25200000-0000-4000-8000-000000000001', 'owner', 'Owner One', 'owner.one@r1c05.example'),
  ('25200000-0000-4000-8000-000000000012', 'consumer', '25200000-0000-4000-8000-000000000001', null, 'Consumer One', 'consumer.one@r1c05.example'),
  ('25200000-0000-4000-8000-000000000021', 'operator_member', '25200000-0000-4000-8000-000000000002', 'owner', 'Owner Two', 'owner.two@r1c05.example'),
  ('25200000-0000-4000-8000-000000000022', 'consumer', '25200000-0000-4000-8000-000000000002', null, 'Consumer Two', 'consumer.two@r1c05.example')
on conflict(id) do update set role = excluded.role, org_id = excluded.org_id,
  org_role = excluded.org_role, full_name = excluded.full_name, email = excluded.email;

insert into public.clients(id, org_id, consumer_profile_id, display_name, assigned_to) values
  ('25200000-0000-4000-8000-000000000101', '25200000-0000-4000-8000-000000000001', '25200000-0000-4000-8000-000000000012', 'Client One', '25200000-0000-4000-8000-000000000011'),
  ('25200000-0000-4000-8000-000000000102', '25200000-0000-4000-8000-000000000002', '25200000-0000-4000-8000-000000000022', 'Client Two', '25200000-0000-4000-8000-000000000021');

insert into public.analysis_jobs(
  id, client_id, source_kind, source_id, analysis_run_id, trigger, available_at
) values
  ('25200000-0000-4000-8000-000000000201', '25200000-0000-4000-8000-000000000101', 'force_pull', '25200000-0000-4000-8000-000000000301', '25200000-0000-4000-8000-000000000401', 'force_pull', pg_catalog.now()),
  ('25200000-0000-4000-8000-000000000202', '25200000-0000-4000-8000-000000000102', 'force_pull', '25200000-0000-4000-8000-000000000302', '25200000-0000-4000-8000-000000000402', 'force_pull', pg_catalog.now() - interval '1 minute');

select has_function('public', 'claim_analysis_job', array['uuid', 'uuid', 'uuid', 'integer'], 'targeted analysis claim exists');
select is(
  (select analysis_run_id from public.claim_analysis_job(
    '25200000-0000-4000-8000-000000000401',
    '25200000-0000-4000-8000-000000000101',
    '25200000-0000-4000-8000-000000000901', 60
  )),
  '25200000-0000-4000-8000-000000000401'::uuid,
  'the requested run is claimed even when another job is older'
);
select is(
  (select status from public.analysis_jobs where analysis_run_id = '25200000-0000-4000-8000-000000000402'),
  'queued'::public.analysis_job_status,
  'the older neighbouring job remains queued'
);
select is(
  (select count(*) from public.claim_analysis_job(
    '25200000-0000-4000-8000-000000000401',
    '25200000-0000-4000-8000-000000000102',
    '25200000-0000-4000-8000-000000000902', 60
  )),
  0::bigint,
  'a client mismatch claims nothing'
);
select results_eq(
  $$select status::text, lease_owner::text from public.claim_analysis_job(
    '25200000-0000-4000-8000-000000000401',
    '25200000-0000-4000-8000-000000000101',
    '25200000-0000-4000-8000-000000000902', 60
  )$$,
  $$values ('running'::text, '25200000-0000-4000-8000-000000000901'::text)$$,
  'a simultaneous target sees the live owner without taking the lease'
);

update public.analysis_jobs set status = 'succeeded', lease_owner = null, lease_until = null
where analysis_run_id = '25200000-0000-4000-8000-000000000401';
select is(
  (select status from public.claim_analysis_job(
    '25200000-0000-4000-8000-000000000401',
    '25200000-0000-4000-8000-000000000101',
    '25200000-0000-4000-8000-000000000902', 60
  )),
  'succeeded'::public.analysis_job_status,
  'a terminal inner row is returned without mutation'
);

update public.analysis_jobs
set available_at = pg_catalog.now() + interval '5 minutes'
where analysis_run_id = '25200000-0000-4000-8000-000000000402';
select is(
  (select status from public.claim_analysis_job(
    '25200000-0000-4000-8000-000000000402',
    '25200000-0000-4000-8000-000000000102',
    '25200000-0000-4000-8000-000000000902', 60
  )),
  'queued'::public.analysis_job_status,
  'a delayed target is returned without a lease'
);
select is((select attempt_count from public.analysis_jobs where analysis_run_id = '25200000-0000-4000-8000-000000000402'), 0, 'delayed inspection does not consume an attempt');
select ok(
  not has_function_privilege('authenticated', 'public.claim_analysis_job(uuid,uuid,uuid,integer)', 'execute'),
  'authenticated callers cannot target analysis claims'
);
select ok(
  has_function_privilege('service_role', 'public.claim_analysis_job(uuid,uuid,uuid,integer)', 'execute'),
  'service role can target analysis claims'
);
select ok(
  pg_get_functiondef('public.claim_analysis_job(uuid,uuid,uuid,integer)'::regprocedure) like '%for update%',
  'target claims serialize on the exact inner row'
);
select is(
  (select count(*) from public.audit_log where subject_id = '25200000-0000-4000-8000-000000000201' and action = 'analysis_job.transition'),
  1::bigint,
  'the queued-to-running target transition is audited once'
);

select * from finish();
rollback;
