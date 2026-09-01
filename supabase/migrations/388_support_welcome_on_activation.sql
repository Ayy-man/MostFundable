-- 388_support_welcome_on_activation.sql — chat rebuild, migration range 384-389.
--
-- The welcome message a consumer finds already waiting in their team chat.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration, and never `supabase db reset` from a lane worktree —
-- one shared local stack serves every lane and a reset destroys the others.
--
-- Plan §2 asks for a welcome "seeded on enrollment from the operator's brand so
-- no consumer ever sees an empty conversation". Three things follow from taking
-- that literally, and each one rules out an easier implementation:
--
--   (a) It is a real row in public.support_messages, written by
--       public.support_send_message like every other message. A client-side
--       placeholder would be a message that exists only while a component is
--       mounted -- the operator's inbox would never show it, a reply would
--       answer nothing, and the consumer's first experience of the product
--       would be text that vanishes on reload.
--   (b) Its author is a real operator profile, resolved from the client. The
--       assigned operator first, then an owner of the client's org. If neither
--       exists the function does nothing, because a fabricated author is worse
--       than an empty thread: migration 100's whole claim is that every message
--       names a person, and this is not the place to make that a lie.
--   (c) It fires on the transition INTO `active`, not when the enrollment row
--       is created. `enrollment_begin` inserts `enrolled` before identity is
--       verified and before anything is charged, so a welcome there would greet
--       somebody whose enrollment can still fail. `active` is the first moment
--       the client is really a client.
--
-- The hook is a trigger on the status transition rather than a call added to
-- `enrollment_idv_settled`. Several paths reach `active` -- IDV settlement,
-- migration 330's paid consumer activation, migration 181's settlement repair --
-- and a call bolted into one of them would seed a welcome for some enrollments
-- and not others, with nothing to say which. A predicate over the transition
-- covers every path that exists and every path added later; this codebase has
-- learned that lesson often enough (round 4's regression round, round 5's
-- catalog rule) that an enumeration here would be a choice to repeat it.
--
-- EVERY BRANCH RETURNS RATHER THAN RAISES. This runs inside the transaction
-- that activates an enrollment, which is the transaction that charges somebody.
-- A missing welcome is a cosmetic gap; an aborted activation is a failed
-- payment and a client stuck between states. So each way this can fail to have
-- something to say is a `return`, and the guards below are exhaustive by
-- construction rather than by hope: no operator, no client, a thread that is
-- not open, a thread that already holds a message.
--
-- Wholly additive. No existing function, table, policy or grant is altered.


-- ---------------------------------------------------------------------------
-- Part 1: the copy, in exactly one place.
-- ---------------------------------------------------------------------------

-- A function rather than a literal inside the seeding routine, so the wording
-- has one home and a test can read it back out instead of transcribing it. The
-- round-5 standard is that an assertion derives from whatever owns the fact;
-- this is what lets the test for this migration do that.
create function private.support_welcome_body(
  p_org_name text,
  p_operator_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Welcome to ' || pg_catalog.btrim(p_org_name) || '. I am '
    || pg_catalog.btrim(p_operator_name)
    || ', and this thread is where you and your team talk. Send me anything you want to ask, and I will answer here. Your Today view shows the next step whenever you are ready to pick it up.'
$$;

revoke all on function private.support_welcome_body(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Part 2: seeding one client's welcome.
-- ---------------------------------------------------------------------------

create function private.seed_support_welcome(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_operator public.profiles;
  v_thread public.support_threads;
  v_org_name text;
begin
  select client.*
  into v_client
  from public.clients as client
  where client.id = p_client_id;

  if v_client.id is null then
    return;
  end if;

  -- The assigned operator is the right voice: they are the person the consumer
  -- will actually be talking to, and the tracker already shows their name.
  select profile.*
  into v_operator
  from public.profiles as profile
  where profile.id = v_client.assigned_to
    and profile.role = 'operator_member'
    and profile.org_id = v_client.org_id
    and profile.disabled_at is null;

  -- An unassigned client still deserves a welcome, so an owner of the org
  -- speaks instead. Ordered rather than arbitrary, so two clients activating in
  -- the same second do not get two different voices for no reason.
  if v_operator.id is null then
    select profile.*
    into v_operator
    from public.profiles as profile
    where profile.org_id = v_client.org_id
      and profile.role = 'operator_member'
      and profile.org_role = 'owner'
      and profile.disabled_at is null
    order by profile.created_at, profile.id
    limit 1;
  end if;

  if v_operator.id is null then
    return;
  end if;

  select thread.*
  into v_thread
  from public.support_threads as thread
  where thread.client_id = p_client_id
    and thread.kind = 'team_chat';

  if v_thread.id is not null then
    -- A resolved thread is a conversation somebody deliberately closed, and a
    -- thread that already holds a message has already been started -- by the
    -- seed, by an operator, or by a previous activation of a client who
    -- re-enrolled. None of those wants a second hello.
    if v_thread.status <> 'open' then
      return;
    end if;

    if exists (
      select 1
      from public.support_messages as message
      where message.thread_id = v_thread.id
    ) then
      return;
    end if;
  else
    v_thread := public.support_open_thread(
      'team_chat',
      v_client.org_id,
      p_client_id,
      'Welcome and first steps',
      v_operator.id
    );
  end if;

  select organization.name
  into v_org_name
  from public.orgs as organization
  where organization.id = v_client.org_id;

  if v_org_name is null or pg_catalog.btrim(v_org_name) = '' then
    return;
  end if;

  perform public.support_send_message(
    v_thread.id,
    v_operator.id,
    'operator',
    private.support_welcome_body(v_org_name, v_operator.full_name),
    null,
    'participants'
  );
end;
$$;

revoke all on function private.seed_support_welcome(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Part 3: the hook.
-- ---------------------------------------------------------------------------

create function private.enrollment_seed_support_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_support_welcome(new.client_id);
  return null;
end;
$$;

revoke all on function private.enrollment_seed_support_welcome() from public, anon, authenticated;

-- AFTER, so a failure to seed cannot be mistaken for a failure to activate, and
-- so the enrollment row is already `active` if anything downstream reads it.
-- The WHEN clause is what keeps this from firing on the seed, which inserts its
-- enrollments already active and never transitions them.
create trigger enrollments_seed_support_welcome
after update of status on public.enrollments
for each row
when (new.status = 'active' and old.status is distinct from 'active')
execute function private.enrollment_seed_support_welcome();

comment on trigger enrollments_seed_support_welcome on public.enrollments is
  'Plan §2: the welcome message a consumer finds waiting, written through support_send_message by a real operator profile at the moment the enrollment becomes active.';
