-- 384_support_realtime_publication.sql — chat rebuild, lane 1a.
--
-- Two support tables join the realtime publication. Held drafts do not.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree — one shared local stack serves
-- every lane and a reset destroys every other lane's state.
--
-- A publication decides which tables the WAL decoder may emit at all. It is not
-- an access grant, and adding a table here widens what can be delivered rather
-- than who may receive it. Supabase's Realtime server reads every candidate row
-- back through Postgres as the *subscriber's* role before forwarding it, so
-- migration 100's read policies remain the whole of the authorization:
-- `authenticated` holds select and nothing else on these tables, and
-- `support_messages_select` requires `private.can_access_support_thread(thread_id)`.
-- A subscriber who fails that predicate receives nothing on the channel, which
-- is why this file adds no policy, no grant, and no view — there was nothing
-- missing to add.
--
-- public.held_drafts is deliberately left out. It is staff-only by policy and
-- it is the one row in this phase carrying machine-written text that no person
-- has yet approved. Nothing in the product needs a draft to arrive without a
-- reload: the operator who asked for it is the operator waiting on the
-- response. Publishing it would widen the delivery surface for no product gain,
-- and `supabase/tests/384_support_realtime_publication.test.sql` fails if a
-- later lane adds it.
--
-- Replica identity stays `default`, meaning the primary key. `full` would put
-- every old column value on the wire for an update or a delete — for
-- support_messages that is the body of an internal note travelling inside a
-- delete event — and a message is insert-only in this schema, so the old image
-- would buy nothing even if it were harmless.
--
-- Wholly additive. No table, policy, grant, or function is altered here.

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication is required';
  end if;

  -- Membership is checked per table rather than added in one statement: a
  -- second run of this migration against a database where one of the two is
  -- already published must be a no-op rather than a duplicate-object error.
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_threads'
  ) then
    alter publication supabase_realtime add table public.support_threads;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end;
$$;
