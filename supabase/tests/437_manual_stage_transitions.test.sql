begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select has_function(
  'private',
  'tracker_transition_client_stage_r1a03_impl',
  array['uuid', 'client_stage', 'client_stage', 'uuid', 'text', 'text'],
  'the tracker implementation remains available behind its public tenant-wall wrapper'
);

insert into auth.users (id, email)
values ('43600000-0000-4000-8000-000000000001', 'operator@manual-stage.test');

insert into public.orgs (id, name, slug)
values (
  '43600000-0000-4000-8000-000000000101',
  'Manual Stage Transition Org',
  'manual-stage-transition-org'
);

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values (
  '43600000-0000-4000-8000-000000000001',
  'operator_member',
  '43600000-0000-4000-8000-000000000101',
  'owner',
  'Manual Stage Operator',
  'operator@manual-stage.test'
)
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients (id, org_id, display_name, stage, stage_entered_at)
values
  (
    '43600000-0000-4000-8000-000000000201',
    '43600000-0000-4000-8000-000000000101',
    'Manual Stage Client',
    'onboarding',
    '2026-09-05T00:00:00Z'
  ),
  (
    '43600000-0000-4000-8000-000000000202',
    '43600000-0000-4000-8000-000000000101',
    'Automatic Stage Client',
    'onboarding',
    '2026-09-05T00:00:00Z'
  );
select pg_catalog.set_config('app.governed_client_write', '', true);

create function pg_temp.stage_transition_error_detail()
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  perform *
  from public.tracker_transition_client_stage(
    '43600000-0000-4000-8000-000000000201',
    'funded',
    'onboarding',
    '43600000-0000-4000-8000-000000000001',
    'manual',
    null
  );
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', '43600000-0000-4000-8000-000000000001')::text,
  true
);

select throws_ok(
  $$
    select *
    from public.tracker_transition_client_stage(
      '43600000-0000-4000-8000-000000000201',
      'funded',
      'onboarding',
      '43600000-0000-4000-8000-000000000001',
      'manual',
      null
    )
  $$,
  'P0001',
  'stage_transition_not_allowed',
  'a manual move cannot skip forward through tracker stages'
);

select is(
  pg_temp.stage_transition_error_detail(),
  'from=onboarding,to=funded',
  'a denied manual move reports its persisted from and requested to stages'
);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '43600000-0000-4000-8000-000000000201',
      'optimization',
      'onboarding',
      '43600000-0000-4000-8000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('transitioned'::text, 'optimization'::public.client_stage) $$,
  'a manual move may advance one stage'
);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '43600000-0000-4000-8000-000000000201',
      'onboarding',
      'optimization',
      '43600000-0000-4000-8000-000000000001',
      'manual',
      null
    )
  $$,
  $$ values ('transitioned'::text, 'onboarding'::public.client_stage) $$,
  'a manual move may correct back one stage'
);

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq(
  $$
    select result, current_stage
    from public.tracker_transition_client_stage(
      '43600000-0000-4000-8000-000000000202',
      'optimization',
      'onboarding',
      null,
      'enrollment',
      'enrollment:437:automatic'
    )
  $$,
  $$ values ('transitioned'::text, 'optimization'::public.client_stage) $$,
  'the system enrollment transition remains unchanged'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.stage_history
    where client_id = '43600000-0000-4000-8000-000000000201'
  ),
  2,
  'only the two allowed manual moves create history'
);

select is(
  (
    select count(*)::integer
    from public.audit_log
    where client_id = '43600000-0000-4000-8000-000000000201'
      and action = 'client.stage.transitioned'
  ),
  2,
  'only the two allowed manual moves create audit evidence'
);

select * from finish();
rollback;
