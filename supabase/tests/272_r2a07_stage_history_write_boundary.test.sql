begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.orgs (id, name, slug, team_sees_all_clients)
values ('27200000-0000-4000-8000-000000000001', 'R2A History Org', 'r2a-history-org', true);

insert into auth.users (id, email, raw_app_meta_data)
values
  ('27200000-0000-4000-8000-000000000011', 'owner-r2a07@test.example', '{"app_role":"operator_member","org_id":"27200000-0000-4000-8000-000000000001","org_role":"owner"}'),
  ('27200000-0000-4000-8000-000000000012', 'admin-r2a07@test.example', '{"app_role":"operator_member","org_id":"27200000-0000-4000-8000-000000000001","org_role":"admin"}'),
  ('27200000-0000-4000-8000-000000000013', 'member-r2a07@test.example', '{"app_role":"operator_member","org_id":"27200000-0000-4000-8000-000000000001","org_role":"member"}');

insert into public.clients (id, org_id, display_name, assigned_to)
values (
  '27200000-0000-4000-8000-000000000101',
  '27200000-0000-4000-8000-000000000001',
  'R2A History Client',
  '27200000-0000-4000-8000-000000000011'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27200000-0000-4000-8000-000000000011"}';
select throws_ok(
  $$insert into public.stage_history (client_id, from_stage, to_stage, changed_by)
    values ('27200000-0000-4000-8000-000000000101','onboarding','funded','27200000-0000-4000-8000-000000000011')$$,
  '42501', null, 'owner cannot insert stage history directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27200000-0000-4000-8000-000000000012"}';
select throws_ok(
  $$insert into public.stage_history (client_id, from_stage, to_stage, changed_by)
    values ('27200000-0000-4000-8000-000000000101','onboarding','funded','27200000-0000-4000-8000-000000000012')$$,
  '42501', null, 'admin cannot insert stage history directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27200000-0000-4000-8000-000000000013"}';
select throws_ok(
  $$insert into public.stage_history (client_id, from_stage, to_stage, changed_by)
    values ('27200000-0000-4000-8000-000000000101','onboarding','funded','27200000-0000-4000-8000-000000000013')$$,
  '42501', null, 'member cannot insert stage history directly'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"27200000-0000-4000-8000-000000000011"}';
select results_eq(
  $$select result, current_stage from public.tracker_transition_client_stage(
    '27200000-0000-4000-8000-000000000101', 'optimization', 'onboarding',
    '27200000-0000-4000-8000-000000000011', 'manual', null
  )$$,
  $$values ('transitioned'::text, 'optimization'::public.client_stage)$$,
  'atomic stage transition remains available to the owner'
);

select results_eq(
  $$
    select client.stage, history.from_stage, history.to_stage,
      (client.stage_entered_at = history.changed_at
       and history.changed_at = audit.occurred_at) as one_timestamp,
      history.changed_by, audit.actor_profile_id
    from public.clients as client
    join public.stage_history as history on history.client_id = client.id
      and history.to_stage = client.stage
    join public.audit_log as audit on audit.client_id = client.id
      and audit.action = 'client.stage.transitioned'
    where client.id = '27200000-0000-4000-8000-000000000101'
  $$,
  $$values (
    'optimization'::public.client_stage,
    'onboarding'::public.client_stage,
    'optimization'::public.client_stage,
    true,
    '27200000-0000-4000-8000-000000000011'::uuid,
    '27200000-0000-4000-8000-000000000011'::uuid
  )$$,
  'transition writes one client, history, and audit tuple with one timestamp and actor'
);

select * from finish();
rollback;
