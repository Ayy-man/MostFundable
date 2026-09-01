-- 101_support_send_guard.sql — Phase 13 (S2.5), migration range 100-109.
--
-- The only write path into the support tables.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration in the 100-109 range. Never edit this file once it is
-- merged, and never `supabase db reset` from a lane worktree.
--
-- Migration 100 left `authenticated` with select and nothing else on all three
-- support tables, so nothing can write them except a security definer function.
-- This file supplies exactly five, and only one of the five can create a
-- message. That asymmetry is the point of SUPP-01: a reviewer greps the schema
-- for `insert into public.support_messages`, finds one function, and reads its
-- first statement, which rejects a null human.
--
-- Two authorization regimes meet here. service_role bypasses RLS entirely, so
-- the admin client reaching these functions carries no authorization at all —
-- every one of them therefore takes p_actor_profile_id explicitly and re-checks
-- it through private.profile_can_access_support_thread. RLS remains the
-- authorization for reads and nothing else.
--
-- Every state change appends exactly one public.audit_log row through
-- private.audit_support_event, using only the ten keys private.audit_meta_valid
-- allows. No message body, draft body, or thread subject enters meta — not
-- truncated, not hashed, not at all.


-- ---------------------------------------------------------------------------
-- Part 1: the audit writer.
-- ---------------------------------------------------------------------------

create function private.audit_support_event(
  p_org_id uuid,
  p_client_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_subject_type text,
  p_subject_id uuid,
  p_meta jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (
    org_id,
    client_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    meta
  ) values (
    p_org_id,
    p_client_id,
    p_actor_profile_id,
    p_action,
    p_subject_type,
    p_subject_id,
    p_meta
  );
$$;

revoke all on function private.audit_support_event(
  uuid, uuid, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function private.audit_support_event(
  uuid, uuid, uuid, text, text, uuid, jsonb
) to service_role;


-- ---------------------------------------------------------------------------
-- Part 2: opening a thread.
-- ---------------------------------------------------------------------------
--
-- Idempotent for team_chat. Migration 100 caps a client at one such thread, so
-- a second call means the caller wanted that client's chat rather than a new
-- one; returning the existing row is more useful than surfacing a raw unique
-- violation, and writing no second audit row keeps the trail honest about what
-- actually changed.

create function public.support_open_thread(
  p_kind public.support_thread_kind,
  p_org_id uuid,
  p_client_id uuid,
  p_subject text,
  p_actor_profile_id uuid
)
returns public.support_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_client public.clients;
  v_thread public.support_threads;
  v_permitted boolean := false;
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

  if p_kind = 'team_chat' then
    if p_client_id is null then
      raise exception using errcode = 'P0001', message = 'SUPPORT_THREAD_SCOPE_INVALID';
    end if;

    select client.*
    into v_client
    from public.clients as client
    where client.id = p_client_id
      and client.org_id = p_org_id;

    if v_client.id is null then
      raise exception using errcode = 'P0001', message = 'SUPPORT_THREAD_SCOPE_INVALID';
    end if;

    v_permitted := case
      when v_profile.role = 'platform_admin' then true
      when v_profile.role = 'consumer' then v_client.consumer_profile_id = v_profile.id
      when v_profile.role = 'operator_member' then v_client.org_id = v_profile.org_id
      else false
    end;

    select thread.*
    into v_thread
    from public.support_threads as thread
    where thread.client_id = p_client_id
      and thread.kind = 'team_chat';
  else
    if p_client_id is not null then
      raise exception using errcode = 'P0001', message = 'SUPPORT_THREAD_SCOPE_INVALID';
    end if;

    v_permitted := case
      when v_profile.role = 'platform_admin' then true
      when v_profile.role = 'operator_member' then v_profile.org_id = p_org_id
      else false
    end;
  end if;

  if not v_permitted then
    raise exception using errcode = 'P0001', message = 'SUPPORT_FORBIDDEN';
  end if;

  if v_thread.id is not null then
    return v_thread;
  end if;

  insert into public.support_threads (kind, org_id, client_id, subject, created_by)
  values (p_kind, p_org_id, p_client_id, p_subject, p_actor_profile_id)
  returning * into strict v_thread;

  perform private.audit_support_event(
    v_thread.org_id,
    v_thread.client_id,
    p_actor_profile_id,
    'support.thread_opened',
    'support_thread',
    v_thread.id,
    jsonb_build_object('source', v_thread.kind::text, 'status', v_thread.status::text)
  );

  return v_thread;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 3: recording a draft.
-- ---------------------------------------------------------------------------
--
-- SUPPORT_DRAFT_EXISTS rather than a silent supersede (IA-13-07). Replacing an
-- open draft automatically would be a state change with no human actor, which
-- is DEC-D10 in miniature; the composer discards first, so every discard lands
-- in discarded_by with a name on it.
--
-- The status derivation below mirrors runDraftEngine exactly, and migration
-- 100's held_drafts_gates_for_approval re-derives it a third time. Two
-- independent derivations that disagree produce a check violation rather than a
-- sendable draft, which is the direction a disagreement should fail in.

create function public.support_record_draft(
  p_thread_id uuid,
  p_body text,
  p_confidence numeric,
  p_confidence_threshold numeric,
  p_supervisor_approved boolean,
  p_guardrail_flags text[],
  p_driver text,
  p_model text,
  p_prompt_key text,
  p_prompt_version integer,
  p_actor_profile_id uuid
)
returns public.held_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_draft public.held_drafts;
  v_thread public.support_threads;
  v_flags text[] := coalesce(p_guardrail_flags, '{}'::text[]);
  v_reason text;
  v_status public.held_draft_status;
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

  -- Drafts are staff-side, matching migration 100's held_drafts_select policy.
  -- A consumer cannot read a draft, so a consumer must not be able to make one.
  if v_profile.role not in ('operator_member', 'platform_admin')
    or not private.profile_can_access_support_thread(p_actor_profile_id, p_thread_id) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_FORBIDDEN';
  end if;

  select thread.*
  into strict v_thread
  from public.support_threads as thread
  where thread.id = p_thread_id;

  if exists (
    select 1
    from public.held_drafts as draft
    where draft.thread_id = p_thread_id
      and draft.status in ('draft', 'approved')
  ) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_EXISTS';
  end if;

  v_reason := case
    when not p_supervisor_approved then 'supervisor_rejected'
    when cardinality(v_flags) > 0 then 'guardrail_flagged'
    when p_confidence < p_confidence_threshold then 'confidence_below_threshold'
    else 'gates_passed'
  end;

  v_status := case
    when v_reason = 'gates_passed' then 'approved'::public.held_draft_status
    else 'draft'::public.held_draft_status
  end;

  insert into public.held_drafts (
    thread_id,
    body,
    confidence,
    confidence_threshold,
    supervisor_approved,
    guardrail_flags,
    status,
    driver,
    model,
    prompt_key,
    prompt_version
  ) values (
    p_thread_id,
    p_body,
    p_confidence,
    p_confidence_threshold,
    p_supervisor_approved,
    v_flags,
    v_status,
    p_driver,
    p_model,
    p_prompt_key,
    p_prompt_version
  )
  returning * into strict v_draft;

  perform private.audit_support_event(
    v_thread.org_id,
    v_thread.client_id,
    p_actor_profile_id,
    'support.draft_recorded',
    'held_draft',
    v_draft.id,
    jsonb_build_object(
      'driver', v_draft.driver,
      'status', v_draft.status::text,
      'reason_code', v_reason,
      'count', cardinality(v_flags),
      'version', 'support-draft.v1'
    )
  );

  return v_draft;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 4: discarding a draft.
-- ---------------------------------------------------------------------------

create function public.support_discard_draft(
  p_draft_id uuid,
  p_actor_profile_id uuid
)
returns public.held_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_before public.held_drafts;
  v_after public.held_drafts;
  v_thread public.support_threads;
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

  select draft.*
  into v_before
  from public.held_drafts as draft
  where draft.id = p_draft_id
  for update;

  if v_before.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_NOT_FOUND';
  end if;

  if v_profile.role not in ('operator_member', 'platform_admin')
    or not private.profile_can_access_support_thread(p_actor_profile_id, v_before.thread_id) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_FORBIDDEN';
  end if;

  if v_before.status not in ('draft', 'approved') then
    raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_NOT_OPEN';
  end if;

  update public.held_drafts
  set status = 'discarded',
      discarded_by = p_actor_profile_id,
      discarded_at = now()
  where id = v_before.id
  returning * into strict v_after;

  select thread.*
  into strict v_thread
  from public.support_threads as thread
  where thread.id = v_after.thread_id;

  perform private.audit_support_event(
    v_thread.org_id,
    v_thread.client_id,
    p_actor_profile_id,
    'support.draft_discarded',
    'held_draft',
    v_after.id,
    jsonb_build_object('from_state', v_before.status::text, 'to_state', v_after.status::text)
  );

  return v_after;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 5: moving a thread's status.
-- ---------------------------------------------------------------------------

create function public.support_set_thread_status(
  p_thread_id uuid,
  p_status public.support_thread_status,
  p_actor_profile_id uuid
)
returns public.support_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_before public.support_threads;
  v_after public.support_threads;
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
  into strict v_before
  from public.support_threads as thread
  where thread.id = p_thread_id
  for update;

  -- A no-op writes no audit row: the trail records what changed, not what was
  -- asked for.
  if v_before.status = p_status then
    return v_before;
  end if;

  update public.support_threads
  set status = p_status,
      last_activity_at = now()
  where id = v_before.id
  returning * into strict v_after;

  perform private.audit_support_event(
    v_after.org_id,
    v_after.client_id,
    p_actor_profile_id,
    'support.thread_status_changed',
    'support_thread',
    v_after.id,
    jsonb_build_object('from_state', v_before.status::text, 'to_state', v_after.status::text)
  );

  return v_after;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 6: the one writer.
-- ---------------------------------------------------------------------------
--
-- THIS FUNCTION CONTAINS THE ONLY `insert into public.support_messages` IN THE
-- SCHEMA. `supabase/tests/101_support_send_guard.test.sql` asserts that from
-- the catalog, and `web/scripts/verify-no-auto-send.mjs` asserts that exactly
-- one TypeScript file names it. Adding a second insert path anywhere means
-- failing both.
--
-- Seven refusals, in order, before a row exists:
--
--   SUPPORT_ACTOR_REQUIRED       p_actor_profile_id is null
--   SUPPORT_ACTOR_UNKNOWN        no profile row matches
--   SUPPORT_FORBIDDEN            the actor cannot reach the thread
--   SUPPORT_THREAD_CLOSED        the thread is resolved
--   SUPPORT_DRAFT_NOT_FOUND      the draft is missing or on another thread
--   SUPPORT_DRAFT_NOT_APPROVED   the draft has not cleared all three gates
--   SUPPORT_DRAFT_BODY_MISMATCH  the body differs from the audited draft
--
-- The last one is IA-13-06 and is deliberately strict: an ai_assisted message
-- is byte-identical to the draft it names, so the audit record never attributes
-- words to a draft that the draft did not contain. Editing is not "sending the
-- assistant's text with changes" — it discards the draft and sends the person's
-- own text as origin = 'human'.
--
-- The draft is taken `for update` before the message insert, so two concurrent
-- sends of one draft serialize: the winner flips it to sent, and the loser then
-- reads that status and raises SUPPORT_DRAFT_NOT_APPROVED. `unique
-- (origin_draft_id)` on support_messages is the belt to that lock's braces.

create function public.support_send_message(
  p_thread_id uuid,
  p_actor_profile_id uuid,
  p_author_kind public.support_author_kind,
  p_body text,
  p_draft_id uuid default null
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

  insert into public.support_messages (
    thread_id,
    author_profile_id,
    author_kind,
    origin,
    origin_draft_id,
    body
  ) values (
    p_thread_id,
    p_actor_profile_id,
    p_author_kind,
    case
      when p_draft_id is null then 'human'::public.support_message_origin
      else 'ai_assisted'::public.support_message_origin
    end,
    p_draft_id,
    p_body
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

  update public.support_threads
  set last_activity_at = v_message.sent_at
  where id = p_thread_id;

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


-- ---------------------------------------------------------------------------
-- Part 7: grants. service_role and nothing else.
-- ---------------------------------------------------------------------------
--
-- These are reached through the admin client, never from a browser session.
-- `authenticated` holds no execute privilege on any of them, which closes the
-- loop migration 100 opened by removing the table write grant: there is no
-- statement and no function a signed-in session can use to write support data.

revoke all on function public.support_open_thread(
  public.support_thread_kind, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.support_record_draft(
  uuid, text, numeric, numeric, boolean, text[], text, text, text, integer, uuid
) from public, anon, authenticated;
revoke all on function public.support_discard_draft(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.support_set_thread_status(
  uuid, public.support_thread_status, uuid
) from public, anon, authenticated;
revoke all on function public.support_send_message(
  uuid, uuid, public.support_author_kind, text, uuid
) from public, anon, authenticated;

grant execute on function public.support_open_thread(
  public.support_thread_kind, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.support_record_draft(
  uuid, text, numeric, numeric, boolean, text[], text, text, text, integer, uuid
) to service_role;
grant execute on function public.support_discard_draft(uuid, uuid) to service_role;
grant execute on function public.support_set_thread_status(
  uuid, public.support_thread_status, uuid
) to service_role;
grant execute on function public.support_send_message(
  uuid, uuid, public.support_author_kind, text, uuid
) to service_role;
