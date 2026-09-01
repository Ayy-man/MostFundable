-- Phase 13 · migration 102 — the read side, for a session the database cannot see.
--
-- Migration 100 put the visibility rule in one place:
-- `private.profile_can_access_support_thread(profile, thread)`, with
-- `private.can_access_support_thread(thread)` as the thin `auth.uid()` wrapper
-- the three RLS policies use. That split was deliberate — the comment above it
-- says "the RPC path has no session" — and this migration is the RPC path it
-- was anticipating.
--
-- The reason it is needed now rather than later: until lane A's real auth
-- lands, a signed-in person is a demo profile selected by a request header and
-- there is no Supabase JWT behind it, so a PostgREST read with the anon key
-- evaluates `auth.uid()` as null and every policy denies. The alternative the
-- tracker lane took — read with the service key and re-implement the tenant
-- predicate in TypeScript — would put a second copy of the rule in a second
-- language, and the two copies would drift the first time somebody changed one.
-- These four functions re-check the actor with the same SQL predicate the
-- policies use, so the rule keeps exactly one definition.
--
-- Every function here is `security definer` with an empty `search_path`,
-- readable-only, and executable by `service_role` alone. `service_role` already
-- bypasses RLS, so the actor argument is not advisory: it is the only thing
-- standing between a caller and the whole table, which is why each function
-- re-checks it rather than trusting the caller to have done so.

-- ---------------------------------------------------------------------------
-- 1. The threads an actor can see.
-- ---------------------------------------------------------------------------
--
-- The predicate is evaluated per candidate row, which is what an RLS policy
-- does too; the limit keeps that bounded and the caller supplies it so the
-- repository's page size stays on the repository.

create function public.support_list_threads(
  p_actor_profile_id uuid,
  p_limit integer default 100
)
returns setof public.support_threads
language sql
stable
security definer
set search_path = ''
as $$
  select thread.*
  from public.support_threads as thread
  where p_actor_profile_id is not null
    and private.profile_can_access_support_thread(p_actor_profile_id, thread.id)
  order by thread.last_activity_at desc
  limit greatest(coalesce(p_limit, 100), 0)
$$;

-- ---------------------------------------------------------------------------
-- 2. One thread, or no rows.
-- ---------------------------------------------------------------------------
--
-- A thread that does not exist and a thread the actor cannot see both return
-- zero rows, so the response cannot be used to probe for thread ids belonging
-- to another tenant.

create function public.support_read_thread(
  p_thread_id uuid,
  p_actor_profile_id uuid
)
returns setof public.support_threads
language sql
stable
security definer
set search_path = ''
as $$
  select thread.*
  from public.support_threads as thread
  where thread.id = p_thread_id
    and p_actor_profile_id is not null
    and private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id)
$$;

-- ---------------------------------------------------------------------------
-- 3. The messages on a thread the actor can see.
-- ---------------------------------------------------------------------------
--
-- The access check is on the thread rather than on each message, matching
-- `support_messages_select`: a message carries no visibility of its own, and
-- checking per message would invite a future author-scoped variant that the
-- policy does not have.

create function public.support_list_messages(
  p_thread_id uuid,
  p_actor_profile_id uuid,
  p_limit integer default 500
)
returns setof public.support_messages
language sql
stable
security definer
set search_path = ''
as $$
  select message.*
  from public.support_messages as message
  where message.thread_id = p_thread_id
    and p_actor_profile_id is not null
    and private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id)
  order by message.sent_at asc
  limit greatest(coalesce(p_limit, 500), 0)
$$;

-- ---------------------------------------------------------------------------
-- 4. The one open draft on a thread, staff only.
-- ---------------------------------------------------------------------------
--
-- The staff conjunct is repeated here from `held_drafts_select` and it is the
-- one duplication in this file. It is here rather than left to the caller
-- because a consumer reaching this function must get nothing from the database
-- itself — "the repository does not issue the query for a consumer" is a
-- TypeScript fact, and SUPP-02 needs a SQL one. Migration 100's partial unique
-- index caps the open statuses at one row per thread, so this returns at most
-- one row without saying so.

create function public.support_read_open_draft(
  p_thread_id uuid,
  p_actor_profile_id uuid
)
returns setof public.held_drafts
language sql
stable
security definer
set search_path = ''
as $$
  select draft.*
  from public.held_drafts as draft
  where draft.thread_id = p_thread_id
    and draft.status in ('draft', 'approved')
    and p_actor_profile_id is not null
    and exists (
      select 1
      from public.profiles as actor
      where actor.id = p_actor_profile_id
        and actor.role in ('operator_member', 'platform_admin')
    )
    and private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id)
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants.
-- ---------------------------------------------------------------------------

revoke all on function public.support_list_threads(uuid, integer) from public, anon, authenticated;
revoke all on function public.support_read_thread(uuid, uuid) from public, anon, authenticated;
revoke all on function public.support_list_messages(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.support_read_open_draft(uuid, uuid) from public, anon, authenticated;

grant execute on function public.support_list_threads(uuid, integer) to service_role;
grant execute on function public.support_read_thread(uuid, uuid) to service_role;
grant execute on function public.support_list_messages(uuid, uuid, integer) to service_role;
grant execute on function public.support_read_open_draft(uuid, uuid) to service_role;
