-- 386_support_thread_reads.sql — chat rebuild, lane 1a.
--
-- Per-person read watermarks, and the unread count derived from them.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- The badge this feeds is a claim about a person: "there are three messages here
-- you have not seen". A stored count would be a second copy of that claim, and
-- the two copies would disagree the first time a message arrived while nobody
-- was counting — so nothing here stores a count. The table stores one timestamp
-- per (thread, person) and `support_list_thread_digest` derives the number from
-- public.support_messages at read time. A badge can therefore be wrong only in
-- the way the messages themselves are wrong.
--
-- Three structural facts carry the rest:
--
--   (a) The primary key is (thread_id, profile_id), so a person cannot hold two
--       watermarks on one thread and there is no "which row wins" question to
--       answer later.
--   (b) support_mark_thread_read moves the mark with greatest(), so it is
--       monotonic by construction rather than by the caller being careful.
--       A page that finishes rendering an old snapshot after a newer one cannot
--       walk the mark backwards and resurrect messages the person has read.
--   (c) The mark is clamped to now(). The timestamp arrives from a browser and a
--       browser clock can be wrong or hostile; a mark in the future would mute
--       the thread permanently, which is the one failure mode of an unread badge
--       that a person cannot see or correct.
--
-- `authenticated` gets select and nothing else, matching all three support
-- tables: the only writer is the security definer RPC below, granted to
-- service_role alone.


-- ---------------------------------------------------------------------------
-- Part 1: the table.
-- ---------------------------------------------------------------------------
--
-- The thread cascade matches public.support_messages: deleting a thread takes
-- its watermarks with it, because a watermark on a thread that no longer exists
-- is not a record of anything. The profile reference deliberately does not
-- cascade, matching every other profile reference in the support schema — a
-- profile is not deleted in normal operation, and a cascade here would quietly
-- destroy read state on a path nobody reviewed.

create table public.support_thread_reads (
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint support_thread_reads_pkey primary key (thread_id, profile_id)
);

create index support_thread_reads_profile_idx
  on public.support_thread_reads(profile_id, thread_id);

alter table public.support_thread_reads enable row level security;
alter table public.support_thread_reads force row level security;

revoke all on table public.support_thread_reads from public, anon, authenticated;
grant select on table public.support_thread_reads to authenticated;
grant all on table public.support_thread_reads to service_role;

-- Migration 374 swept TRUNCATE off every table that existed when it ran, on the
-- reasoning that no application-reachable role has any business holding it
-- anywhere. `grant all` above hands it straight back, so a table created after
-- that sweep has to take it off again — otherwise the boundary quietly develops
-- a hole one table wide every time somebody adds a table.
revoke truncate on table public.support_thread_reads from public, anon, authenticated, service_role;

-- The rest of migration 374's boundary treatment, which a table added after the
-- sweep has to apply to itself: no application-reachable role deletes from it,
-- and an ALWAYS statement guard refuses TRUNCATE even to a SECURITY DEFINER
-- function, which a revoked grant never would. Nothing deletes a watermark on its own: the row goes when its thread goes, through the cascade, which runs as the system rather than under a grant.
revoke delete on table public.support_thread_reads from public, anon, authenticated, service_role;

create trigger support_thread_reads_no_truncate
before truncate on public.support_thread_reads
for each statement execute function public.append_only_guard();

alter table public.support_thread_reads enable always trigger support_thread_reads_no_truncate;

-- Two conjuncts, and the second is the interesting one. A watermark is a fact
-- about a person, not about the thread, so being able to read the thread is not
-- enough to read when a colleague last opened it. "Avery last read this eight
-- days ago" is a different product than an unread badge, and it is not one
-- anybody has asked for; when somebody does, it will be a policy change here
-- that a reviewer can see, rather than data that was already flowing.
create policy support_thread_reads_select
on public.support_thread_reads
for select
to authenticated
using (
  profile_id = (select private.auth_profile_id())
  and private.can_access_support_thread(thread_id)
);


-- ---------------------------------------------------------------------------
-- Part 2: moving the mark.
-- ---------------------------------------------------------------------------
--
-- Three refusals, matching migration 101's vocabulary exactly so that a route
-- maps them with the table it already has:
--
--   SUPPORT_ACTOR_REQUIRED  p_actor_profile_id is null
--   SUPPORT_ACTOR_UNKNOWN   no profile row matches
--   SUPPORT_FORBIDDEN       the actor cannot reach the thread
--
-- No audit row is written. public.audit_log records what changed about a
-- client's file; "somebody looked at a conversation they are already a
-- participant in" changes nothing about it, and writing one row per pane focus
-- would bury the events the trail exists to make findable.

create function public.support_mark_thread_read(
  p_thread_id uuid,
  p_actor_profile_id uuid,
  p_last_read_at timestamptz
)
returns public.support_thread_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_mark timestamptz;
  v_row public.support_thread_reads;
begin
  if p_actor_profile_id is null then
    raise exception using errcode = 'P0001', message = 'SUPPORT_ACTOR_REQUIRED';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = p_actor_profile_id;

  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPORT_ACTOR_UNKNOWN';
  end if;

  if not private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_FORBIDDEN';
  end if;

  -- A null mark means "now": the caller opened the pane and did not say when.
  -- The clamp is what makes a browser clock harmless.
  v_mark := least(coalesce(p_last_read_at, now()), now());

  insert into public.support_thread_reads (thread_id, profile_id, last_read_at)
  values (p_thread_id, p_actor_profile_id, v_mark)
  on conflict (thread_id, profile_id) do update
  set last_read_at = greatest(excluded.last_read_at, public.support_thread_reads.last_read_at),
      updated_at = now()
  returning * into strict v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 3: the derived digest.
-- ---------------------------------------------------------------------------
--
-- One function serves both the list and the single thread, because the two
-- answers have to agree and the cheapest way to guarantee that is for them to
-- be the same query. p_thread_id null means "every thread this actor can see".
--
-- Three things are derived rather than stored, and each one is derived from the
-- rows that own the fact:
--
--   unread_count          counted from public.support_messages, excluding what
--                         this person wrote — your own message is not news to
--                         you — and excluding anything migration 385 says this
--                         person may not read, so an internal note never shows
--                         up as an unread the client cannot open.
--   last_message_preview  the newest message this actor may read, truncated.
--                         Truncation is here rather than in TypeScript so that
--                         a caller cannot accidentally ship the whole body to a
--                         list view that only renders one line of it.
--   last_read_at          null when the person has never opened the thread,
--                         which the left join produces naturally; every message
--                         then counts as unread, which is what "never opened"
--                         means.
--
-- Read-only and `stable`, like migration 102's four reads, and granted to
-- service_role alone for the same reason: the RPC path has no session, so the
-- actor is an argument and the function re-checks it with the same predicate the
-- policies use.

create function public.support_list_thread_digest(
  p_actor_profile_id uuid,
  p_thread_id uuid default null,
  p_limit integer default 100
)
returns table (
  thread_id uuid,
  last_read_at timestamptz,
  unread_count integer,
  last_message_preview text
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
-- Part 4: grants. service_role and nothing else.
-- ---------------------------------------------------------------------------

revoke all on function public.support_mark_thread_read(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.support_list_thread_digest(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.support_mark_thread_read(uuid, uuid, timestamptz) to service_role;
grant execute on function public.support_list_thread_digest(uuid, uuid, integer) to service_role;
