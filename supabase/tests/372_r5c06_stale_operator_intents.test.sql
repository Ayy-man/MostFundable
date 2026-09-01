begin;
set local search_path = public, extensions;

-- 2026-08-18 R5C-06: migration 358 made a later `POST /api/billing/subscription` reconcile a
-- crashed intent and never made that caller exist. This is the discovery half of the caller
-- the tick supplies — metadata only, and deliberately without the provider reference, so the
-- reconciler has to ask the provider rather than settle against a value it was handed.
select plan(8);

create temporary table r5f3_org as
select organization.id
from public.orgs as organization
where not exists (
  select 1 from public.operator_subscription_creation_intents as intent
  where intent.org_id = organization.id
)
order by organization.id
limit 2;

select cmp_ok((select pg_catalog.count(*) from r5f3_org), '>=', 2::bigint,
  'two organizations with no live intent are available');

insert into public.operator_subscription_creation_intents (org_id, creation_path, created_at)
select organization.id, 'direct', pg_catalog.now() - interval '3 hours'
from r5f3_org as organization
order by organization.id
limit 1;

select is(
  (select pg_catalog.count(*)
   from public.list_stale_operator_subscription_intents(pg_catalog.now() - interval '15 minutes')),
  1::bigint,
  'an intent whose process died three hours ago is discoverable with no HTTP caller'
);

select is(
  (select stale.creation_path
   from public.list_stale_operator_subscription_intents(pg_catalog.now() - interval '15 minutes') as stale),
  'direct',
  'the reconciler is told which route opened the intent, so it can close it on the same one'
);

select is(
  (select pg_catalog.count(*)
   from public.list_stale_operator_subscription_intents(pg_catalog.now() - interval '4 hours')),
  0::bigint,
  'an intent a live request may still own is left alone'
);

-- Terminal states are not the reconciler's business; only `pending` can still be finished.
update public.operator_subscription_creation_intents
set status = 'review', review_reason = 'unreconciled_past_retention', updated_at = pg_catalog.now()
where org_id = (select id from r5f3_org order by id limit 1);

select is(
  (select pg_catalog.count(*)
   from public.list_stale_operator_subscription_intents(pg_catalog.now() - interval '15 minutes')),
  0::bigint,
  'an intent already parked for review is not reopened by the tick'
);

select is(
  pg_catalog.pg_get_function_result(
    'public.list_stale_operator_subscription_intents(timestamptz,integer)'::regprocedure),
  'TABLE(org_id uuid, operation_id uuid, creation_path text, created_at timestamp with time zone)',
  'the selector carries no provider reference — the provider is the authority, not this row'
);

select ok(
  pg_catalog.has_function_privilege('service_role',
    'public.list_stale_operator_subscription_intents(timestamptz,integer)'::regprocedure, 'execute'),
  'the tick can read stale intents'
);

select ok(
  not pg_catalog.has_function_privilege('authenticated',
    'public.list_stale_operator_subscription_intents(timestamptz,integer)'::regprocedure, 'execute'),
  'no session-scoped role can enumerate another tenant intents'
);

select * from finish();
rollback;
