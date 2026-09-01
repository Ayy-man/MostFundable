-- 385_support_internal_notes.sql — chat rebuild, lane 1a.
--
-- An operator-only note, written into the same thread the client reads.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- The dangerous shape for this feature is a note that is a note only because a
-- query remembered to exclude it. Every read path would then have to remember,
-- and the first one that forgot would put a colleague's private assessment in
-- front of the person it was about. So the visibility rule is placed where
-- forgetting is not possible:
--
--   (a) public.support_message_visibility is a closed two-value enum, so there
--       is no third state a later lane can invent between "the client sees it"
--       and "the client does not".
--   (b) support_messages_internal_is_staff makes a consumer-authored note
--       unrepresentable. Migration 100's trigger already refuses an author_kind
--       that disagrees with the profile's role, so this check inherits that
--       authority rather than re-deriving it: a row claiming to be a staff note
--       has to name a staff profile to exist at all.
--   (c) support_messages_select is replaced so that RLS — not a WHERE clause in
--       some repository — is what withholds a note from a client. A consumer
--       hand-rolling a PostgREST query against support_messages gets the same
--       filtered set the product shows them.
--   (d) support_list_messages is replaced to apply the same predicate, because
--       it is `security definer` and therefore runs past RLS. This is the one
--       place the rule appears twice, and it appears twice as one function
--       called twice, not as two expressions that can drift: both the policy
--       and the read RPC call private.profile_sees_internal_support_notes.
--   (e) support_messages_internal_never_assisted refuses an internal note that
--       cites a held draft. A draft is written to be sent to the client, and
--       pairing it with a note would let the audit trail record a draft as
--       `sent` when nobody outside the workspace ever saw it.
--
-- support_send_message is replaced whole, the way migration 103 replaced
-- support_open_thread, because plpgsql has no smaller unit and because the new
-- argument changes the signature — `create or replace` would leave the old
-- five-argument function in place as an overload, and an unqualified call would
-- then be ambiguous. All seven of migration 101's refusals survive in their
-- original relative order; two more are inserted after SUPPORT_THREAD_CLOSED
-- and before the draft block, so a request that is wrong about both its
-- visibility and its draft is told about the visibility first.
--
-- Nothing here grants anything new. `authenticated` still holds select and
-- nothing else, and support_send_message is still the only function in the
-- schema that inserts into public.support_messages.


-- ---------------------------------------------------------------------------
-- Part 1: the closed vocabulary.
-- ---------------------------------------------------------------------------

create type public.support_message_visibility as enum (
  'participants',
  'internal'
);


-- ---------------------------------------------------------------------------
-- Part 2: the column, defaulted to the safe value.
-- ---------------------------------------------------------------------------
--
-- `default 'participants'` is the conservative direction for a backfill: every
-- message that existed before this migration was written to be read by the
-- thread's participants, and that is exactly what it now says. The opposite
-- default would have silently hidden the history from every client.

alter table public.support_messages
  add column visibility public.support_message_visibility not null default 'participants';

alter table public.support_messages
  add constraint support_messages_internal_is_staff check (
    visibility = 'participants' or author_kind <> 'consumer'
  );

alter table public.support_messages
  add constraint support_messages_internal_never_assisted check (
    visibility = 'participants' or origin_draft_id is null
  );

-- The inbox reads a thread's notes and its client-visible messages in one pass,
-- so the index carries visibility rather than leaving the filter to a recheck.
create index support_messages_thread_visibility_idx
  on public.support_messages(thread_id, visibility, sent_at);


-- ---------------------------------------------------------------------------
-- Part 3: one definition of "may see a note".
-- ---------------------------------------------------------------------------
--
-- Two authorization regimes meet here for the same reason they meet in
-- migration 100: reads from a browser session run under RLS and resolve the
-- actor through private.auth_profile_id(), while the RPC path runs as
-- service_role with no session at all and must be handed an actor. Both call
-- this function, so the rule has exactly one definition.

create function private.profile_sees_internal_support_notes(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as actor
    where actor.id = p_profile_id
      and actor.role in ('operator_member', 'platform_admin')
  )
$$;

revoke all on function private.profile_sees_internal_support_notes(uuid)
  from public, anon, authenticated;
grant execute on function private.profile_sees_internal_support_notes(uuid) to authenticated;
grant execute on function private.profile_sees_internal_support_notes(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- Part 4: the read policy.
-- ---------------------------------------------------------------------------
--
-- Replaced rather than supplemented. A second policy would be OR-ed with the
-- first, so adding one could only ever widen what a consumer reads; the rule
-- has to narrow the existing policy, which means replacing it. The table still
-- carries exactly one policy, and it is still a read policy, because there is
-- still no write grant for a policy to police.

drop policy support_messages_select on public.support_messages;

create policy support_messages_select
on public.support_messages
for select
to authenticated
using (
  private.can_access_support_thread(thread_id)
  and (
    visibility = 'participants'
    or private.profile_sees_internal_support_notes((select private.auth_profile_id()))
  )
);


-- ---------------------------------------------------------------------------
-- Part 5: the read RPC.
-- ---------------------------------------------------------------------------
--
-- Same signature, so `create or replace` is enough and every existing caller
-- keeps working. The diff against migration 102 is the visibility conjunct.

create or replace function public.support_list_messages(
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
    and (
      message.visibility = 'participants'
      or private.profile_sees_internal_support_notes(p_actor_profile_id)
    )
    and private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id)
  order by message.sent_at asc
  limit greatest(coalesce(p_limit, 500), 0)
$$;


-- ---------------------------------------------------------------------------
-- Part 6: the one writer, replaced whole.
-- ---------------------------------------------------------------------------
--
-- THIS FUNCTION STILL CONTAINS THE ONLY `insert into public.support_messages`
-- IN THE SCHEMA. `supabase/tests/101_support_send_guard.test.sql` asserts that
-- from the catalog and `web/scripts/verify-no-auto-send.mjs` asserts that one
-- TypeScript file names it.
--
-- Nine refusals, in order, before a row exists:
--
--   SUPPORT_ACTOR_REQUIRED       p_actor_profile_id is null
--   SUPPORT_ACTOR_UNKNOWN        no profile row matches
--   SUPPORT_FORBIDDEN            the actor cannot reach the thread
--   SUPPORT_THREAD_CLOSED        the thread is resolved
--   SUPPORT_NOTE_NOT_PERMITTED   a consumer tried to write an internal note
--   SUPPORT_NOTE_DRAFT_CONFLICT  an internal note cited a held draft
--   SUPPORT_DRAFT_NOT_FOUND      the draft is missing or on another thread
--   SUPPORT_DRAFT_NOT_APPROVED   the draft has not cleared all three gates
--   SUPPORT_DRAFT_BODY_MISMATCH  the body differs from the audited draft
--
-- The two new refusals are the RPC's half of the pair; the check constraints in
-- part 2 are the schema's half, and they hold whether this function is reached
-- or replaced. A refusal that names the reason is worth having anyway: a check
-- violation would reach the route as an unrecognized error and collapse to
-- SUPPORT_UNAVAILABLE, which tells an operator nothing about what to change.
--
-- The audit trail keeps the same three keys migration 101 wrote —
-- private.audit_meta_valid permits ten keys and `101_support_send_guard.test.sql`
-- pins message_sent to exactly these three — and carries the new distinction in
-- `reason_code`, which already held a closed set of low-cardinality labels.
-- Whether the client ever saw the message is the single most important thing
-- the trail can say about it, so `internal_note` displaces the send reason
-- rather than sitting beside it: a note can never cite a draft, so the two
-- codes it would otherwise have to share a field with are unreachable here.

drop function public.support_send_message(
  uuid, uuid, public.support_author_kind, text, uuid
);

create function public.support_send_message(
  p_thread_id uuid,
  p_actor_profile_id uuid,
  p_author_kind public.support_author_kind,
  p_body text,
  p_draft_id uuid default null,
  p_visibility public.support_message_visibility default 'participants'
)
returns public.support_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_thread public.support_threads;
  v_draft public.held_drafts;
  v_message public.support_messages;
  v_visibility public.support_message_visibility := coalesce(p_visibility, 'participants');
  v_reason text := 'human_send';
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

  select thread.*
  into strict v_thread
  from public.support_threads as thread
  where thread.id = p_thread_id;

  if v_thread.status = 'resolved' then
    raise exception using errcode = 'P0001', message = 'SUPPORT_THREAD_CLOSED';
  end if;

  -- The actor's role is the authority, not p_author_kind: migration 100's
  -- trigger already refuses a kind that disagrees with the role, so checking
  -- the role here cannot be walked around by lying about the kind.
  if v_visibility = 'internal' and not private.profile_sees_internal_support_notes(p_actor_profile_id) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_NOTE_NOT_PERMITTED';
  end if;

  if v_visibility = 'internal' and p_draft_id is not null then
    raise exception using errcode = 'P0001', message = 'SUPPORT_NOTE_DRAFT_CONFLICT';
  end if;

  if p_draft_id is not null then
    select draft.*
    into v_draft
    from public.held_drafts as draft
    where draft.id = p_draft_id
    for update;

    if v_draft.id is null or v_draft.thread_id <> p_thread_id then
      raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_NOT_FOUND';
    end if;

    if v_draft.status <> 'approved' then
      raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_NOT_APPROVED';
    end if;

    if p_body is distinct from v_draft.body then
      raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_BODY_MISMATCH';
    end if;

    v_reason := 'human_send_ai_assisted';
  end if;

  if v_visibility = 'internal' then
    v_reason := 'internal_note';
  end if;

  insert into public.support_messages (
    thread_id,
    author_profile_id,
    author_kind,
    origin,
    origin_draft_id,
    body,
    visibility
  ) values (
    p_thread_id,
    p_actor_profile_id,
    p_author_kind,
    case
      when p_draft_id is null then 'human'::public.support_message_origin
      else 'ai_assisted'::public.support_message_origin
    end,
    p_draft_id,
    p_body,
    v_visibility
  )
  returning * into strict v_message;

  if p_draft_id is not null then
    update public.held_drafts
    set status = 'sent',
        sent_by = p_actor_profile_id,
        sent_at = now(),
        sent_message_id = v_message.id
    where id = p_draft_id;
  end if;

  -- An internal note is not activity the client should see reflected anywhere,
  -- and last_activity_at drives the thread list's ordering and the consumer's
  -- own view of when their team last spoke. A note therefore leaves it alone.
  if v_visibility = 'participants' then
    update public.support_threads
    set last_activity_at = v_message.sent_at
    where id = p_thread_id;
  end if;

  perform private.audit_support_event(
    v_thread.org_id,
    v_thread.client_id,
    p_actor_profile_id,
    'support.message_sent',
    'support_message',
    v_message.id,
    jsonb_build_object(
      'source', v_thread.kind::text,
      'status', 'sent',
      'reason_code', v_reason
    )
  );

  return v_message;
end;
$$;

revoke all on function public.support_send_message(
  uuid, uuid, public.support_author_kind, text, uuid, public.support_message_visibility
) from public, anon, authenticated;

grant execute on function public.support_send_message(
  uuid, uuid, public.support_author_kind, text, uuid, public.support_message_visibility
) to service_role;
