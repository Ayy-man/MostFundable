-- R5C-06 — a claimed operator-subscription intent becomes discoverable without a second
-- HTTP caller.
--
-- Migration 358 made a *later* `POST /api/billing/subscription` reconcile or park an intent
-- whose process died after the provider returned. It never made that caller exist: there is
-- no operator-intent handler and no cadence in the job catalog, so with nobody posting again
-- the provider bills while the intent sits `pending` forever, reaching none of `created`,
-- `failed` or `review`. "Terminal" that is reachable only when somebody happens to ask again
-- is not terminal.
--
-- This is the discovery half and nothing else: metadata only, no writes, and deliberately no
-- provider reference — the reconciler must go to the provider through the same
-- `findOperatorSubscription` read the interactive path uses, because the one thing a recovery
-- path may never do is create a second subscription for an organization. Job names stay
-- frozen (INTERFACES §7), so the reconciler runs as a tick step rather than as a new catalog
-- job.

begin;

create or replace function public.list_stale_operator_subscription_intents(
  p_stale_before timestamptz,
  p_limit integer default 100
)
returns table (
  org_id uuid,
  operation_id uuid,
  creation_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select intent.org_id, intent.operation_id, intent.creation_path, intent.created_at
  from public.operator_subscription_creation_intents as intent
  where intent.status = 'pending'
    and intent.created_at < p_stale_before
  order by intent.created_at, intent.operation_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$fn$;

revoke all on function public.list_stale_operator_subscription_intents(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_stale_operator_subscription_intents(timestamptz, integer)
  to service_role;

comment on function public.list_stale_operator_subscription_intents(timestamptz, integer) is
  'R5C-06: pending operator subscription intents old enough that no live request still owns them.';

commit;
