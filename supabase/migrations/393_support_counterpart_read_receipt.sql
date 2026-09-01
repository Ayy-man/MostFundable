-- 393_support_counterpart_read_receipt.sql — the read receipt under an outbound message.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- Migration 386 stores one watermark per (thread, person) and hands each caller
-- back their own, on the reasoning that "Avery last read this eight days ago" is
-- a different product from an unread badge and nobody had asked for it. Its
-- comment says that when somebody does ask, it will be a policy change here that
-- a reviewer can see rather than data that was already flowing. Somebody asked
-- (owner ruling, 2026-08-24: a message the reader sent should say "Read" once
-- the other side has actually opened the thread past it), so this is that
-- change, and the shape of it is deliberately the narrowest one that answers.
--
-- Four structural facts carry the whole of it:
--
--   (a) `public.support_thread_reads` keeps the select policy migration 386 gave
--       it, untouched. A signed-in session still reads its own row and nothing
--       else. What is added is a derivation inside a SECURITY DEFINER function
--       that already re-checks the actor with the same predicate the policies
--       use, so the new column is reachable only through the digest, only for a
--       thread the actor can already open, and never as a row a query could
--       join against to time somebody's attention message by message.
--   (b) The answer is one instant, not a list of people. `counterpart_read_at`
--       is a `max()` across the other side, so it says "somebody over there has
--       seen up to here" and cannot be resolved back to which colleague opened
--       the thread or how many did. That is the fact a receipt needs; the
--       per-person one is still nobody's product.
--   (c) A colleague on the reader's own side is excluded structurally rather
--       than by the caller filtering afterwards. `private.support_thread_side`
--       labels a profile against the thread, and the derivation demands a label
--       that exists and differs from the actor's. Two operators in one org
--       therefore cannot generate a receipt for each other, which is the mistake
--       a naive `max(last_read_at) where profile_id <> actor` would make and
--       would make silently: the receipt would read as "the client has seen it".
--   (d) `p_actor_profile_id` itself is excluded as well as its side. That is
--       redundant with (c) and kept anyway, because the two conditions defend
--       different failures and the cheap one should not depend on the subtle one
--       staying correct.
--
-- The digest is dropped and recreated rather than replaced: a `create or
-- replace` cannot change a function's OUT parameters, and adding a column to
-- `returns table (...)` is exactly that change. The new column is APPENDED, so
-- every existing column keeps its position and the tests that read the digest's
-- definition by position still address what they meant to. The revoke and grant
-- block at the foot is migration 386's, re-applied verbatim, because a drop
-- takes the grants with it.
--
-- Nothing about the unread count, the preview, or the watermark's own semantics
-- changes here. The three expressions are migration 386's, character for
-- character, so a reviewer diffing the two bodies sees one addition and no
-- edits.


-- ---------------------------------------------------------------------------
-- Part 1: which side of a thread a person is on.
-- ---------------------------------------------------------------------------
--
-- Two thread kinds, and they divide differently, which is why this is a
-- function and not a join condition written inline once:
--
--   team_chat          the client's own profile is the consumer side, and the
--                      staff who serve them are the team side. The consumer side
--                      is read off `clients.consumer_profile_id` rather than off
--                      `profiles.role`, because "a consumer" and "the consumer
--                      this thread is about" are different sets, and the second
--                      is the one a receipt is a claim about.
--   platform_support   there is no consumer at all (migration 100's
--                      support_threads_kind_scope makes client_id null on this
--                      kind). The two sides are the operator raising it and the
--                      platform staff answering, so the split is by role.
--
-- `null` for anybody the thread does not place, and a null side never matches
-- anything below. A profile that holds a stale watermark on a thread it is no
-- longer placed on therefore stops producing receipts, without this function
-- needing to know why it was removed.
--
-- `stable` and SECURITY DEFINER, like every private predicate in the support
-- schema, and granted to service_role only: the one caller is the digest, which
-- runs on the RPC path with no session.

create function private.support_thread_side(
  p_thread_id uuid,
  p_profile_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when thread.kind = 'platform_support' then
      case
        when profile.role = 'operator_member' then 'operator'
        when profile.role = 'platform_admin' then 'platform'
        else null
      end
    else
      case
        when client.consumer_profile_id = profile.id then 'consumer'
        when profile.role in ('operator_member', 'platform_admin') then 'team'
        else null
      end
  end
  from public.support_threads as thread
  join public.profiles as profile on profile.id = p_profile_id
  left join public.clients as client on client.id = thread.client_id
  where thread.id = p_thread_id
$$;

revoke all on function private.support_thread_side(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.support_thread_side(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------------
-- Part 2: the digest, with the counterpart's watermark appended.
-- ---------------------------------------------------------------------------
--
-- `counterpart_read_at` is null in three cases that a surface treats
-- identically, and that is on purpose: nobody on the other side has a watermark,
-- the actor has no side on this thread, or the thread has no other side yet. All
-- three mean "we cannot say this was read", and a receipt that distinguished
-- them would be telling the reader something about the other party's account
-- rather than about their own message.
--
-- The comparison against a message's `sent_at` is deliberately left to the
-- caller rather than folded in here. The digest answers per thread; a receipt is
-- per message, and the messages are already in hand where it renders.

drop function public.support_list_thread_digest(uuid, uuid, integer);

create function public.support_list_thread_digest(
  p_actor_profile_id uuid,
  p_thread_id uuid default null,
  p_limit integer default 100
)
returns table (
  thread_id uuid,
  last_read_at timestamptz,
  unread_count integer,
  last_message_preview text,
  counterpart_read_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    thread.id,
    mark.last_read_at,
    (
      select count(*)::integer
      from public.support_messages as message
      where message.thread_id = thread.id
        and message.author_profile_id <> p_actor_profile_id
        and (
          message.visibility = 'participants'
          or private.profile_sees_internal_support_notes(p_actor_profile_id)
        )
        and (mark.last_read_at is null or message.sent_at > mark.last_read_at)
    ),
    (
      select left(btrim(message.body), 140)
      from public.support_messages as message
      where message.thread_id = thread.id
        and (
          message.visibility = 'participants'
          or private.profile_sees_internal_support_notes(p_actor_profile_id)
        )
      order by message.sent_at desc, message.id desc
      limit 1
    ),
    (
      select max(counterpart.last_read_at)
      from public.support_thread_reads as counterpart
      where counterpart.thread_id = thread.id
        and counterpart.profile_id <> p_actor_profile_id
        and private.support_thread_side(thread.id, p_actor_profile_id) is not null
        and private.support_thread_side(thread.id, counterpart.profile_id) is not null
        and private.support_thread_side(thread.id, counterpart.profile_id)
            <> private.support_thread_side(thread.id, p_actor_profile_id)
    )
  from public.support_threads as thread
  left join public.support_thread_reads as mark
    on mark.thread_id = thread.id
   and mark.profile_id = p_actor_profile_id
  where p_actor_profile_id is not null
    and (p_thread_id is null or thread.id = p_thread_id)
    and private.profile_can_access_support_thread(p_actor_profile_id, thread.id)
  order by thread.last_activity_at desc
  limit greatest(coalesce(p_limit, 100), 0)
$$;


-- ---------------------------------------------------------------------------
-- Part 3: grants. Migration 386's block, re-applied because the drop took it.
-- ---------------------------------------------------------------------------

revoke all on function public.support_list_thread_digest(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.support_list_thread_digest(uuid, uuid, integer) to service_role;
