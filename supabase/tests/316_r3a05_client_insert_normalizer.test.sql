begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
insert into public.clients(
  id, org_id, display_name, stage, stage_entered_at, funded_amount_cents,
  started_at, matches_unlocked_override, status, archived_at, archived_by
) values (
  '31600000-0000-4000-8000-000000000001',
  'a0000000-0000-0000-0000-000000000001', 'R3A05 normalized client',
  'funded', '2099-01-01T00:00:00Z', 999999999, '2099-01-01', true,
  'archived', '2099-01-01T00:00:00Z', 'a1000000-0000-0000-0000-000000000001'
);
reset role;

select results_eq(
  $$select stage::text, funded_amount_cents, matches_unlocked_override,
      status::text, archived_at, archived_by, started_at
    from public.clients where id = '31600000-0000-4000-8000-000000000001'$$,
  $$values ('onboarding'::text, 0::bigint, false, 'active'::text,
      null::timestamptz, null::uuid, current_date)$$,
  'caller-supplied governed client fields are normalized to canonical creation values'
);
select ok(
  (select stage_entered_at < '2099-01-01T00:00:00Z'::timestamptz
   from public.clients where id = '31600000-0000-4000-8000-000000000001'),
  'client creation replaces the caller timestamp with a server timestamp'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select lives_ok(
  $$insert into public.clients(id, org_id, display_name, goal_cents, assigned_to)
    values(
      '31600000-0000-4000-8000-000000000002',
      'a0000000-0000-0000-0000-000000000001',
      'R3A05 ordinary client', 123000,
      'a1000000-0000-0000-0000-000000000001'
    )$$,
  'the ordinary tracker client insert shape still succeeds'
);
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.tracker_transition_client_stage(
  '31600000-0000-4000-8000-000000000002',
  'optimization', 'onboarding', null, 'analysis', 'r3a05-transition'
);
reset role;

select results_eq(
  $$select
      (select count(*) from public.tracker_transition_receipts where event_key = 'r3a05-transition'),
      (select count(*) from public.stage_history where client_id = '31600000-0000-4000-8000-000000000002'),
      (select count(*) from public.audit_log where client_id = '31600000-0000-4000-8000-000000000002' and action = 'client.stage.transitioned'),
      (select receipt.received_at = history.changed_at
          and history.changed_at = audit.occurred_at
          and audit.occurred_at = client.stage_entered_at
       from public.tracker_transition_receipts as receipt
       join public.stage_history as history on history.client_id = receipt.client_id
       join public.audit_log as audit on audit.client_id = receipt.client_id and audit.action = 'client.stage.transitioned'
       join public.clients as client on client.id = receipt.client_id
       where receipt.event_key = 'r3a05-transition')$$,
  $$values (1::bigint, 1::bigint, 1::bigint, true)$$,
  'a governed transition writes one receipt, history row, and audit row on one timestamp'
);

select * from finish();
rollback;
