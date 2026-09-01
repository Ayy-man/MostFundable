-- Early seeded and imported clients could be created directly in their current
-- stage, so the tracker had a truthful stage_entered_at but no history row to
-- render. Record that initial observed stage without inventing a prior stage or
-- actor. New seed data now enters through the governed transition RPC.

begin;

-- Serialize this NOT EXISTS backfill with governed stage-transition inserts.
lock table public.stage_history in share row exclusive mode;

insert into public.stage_history (
  client_id,
  from_stage,
  to_stage,
  changed_at,
  changed_by
)
select
  client.id,
  null,
  client.stage,
  client.stage_entered_at,
  null
from public.clients as client
where client.status = 'active'
  and not exists (
    select 1
    from public.stage_history as history
    where history.client_id = client.id
  );

commit;
