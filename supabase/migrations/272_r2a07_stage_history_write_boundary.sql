-- R2A-07: stage history is written only by the atomic transition RPC.

revoke insert on table public.stage_history from authenticated;
drop policy if exists stage_history_insert_authenticated on public.stage_history;

comment on table public.stage_history is
  'Immutable transition evidence. Authenticated callers read through RLS; only governed database routines append rows.';
