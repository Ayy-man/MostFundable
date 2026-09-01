-- 387_assistant_conversations.sql — chat rebuild, lane 1a.
--
-- The assistant's own history: conversations and the turns inside them.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- This is not a support thread and it must never be mistaken for one. Nothing
-- written here can reach a consumer: there is no consumer scope, no client
-- reference, and no path from these tables into public.support_messages —
-- public.support_send_message remains the only function in the schema that
-- inserts a message, and it does not read this schema. An assistant answer is
-- something a member of staff asked a machine in their own workspace, and it
-- stays there.
--
-- Four structural facts carry the rest:
--
--   (a) public.assistant_scope is a closed two-value enum, and
--       assistant_conversations_scope_org ties each value to the shape its
--       owner has: an operator conversation names an org, an admin conversation
--       cannot. A conversation that is scoped to nothing is not expressible.
--   (b) The visibility rule lives in
--       private.profile_can_access_assistant_conversation and is reached by the
--       RLS policies and by every read RPC, so there is one definition of who
--       may see a conversation rather than one per caller.
--   (c) `authenticated` holds select and nothing else on both tables, exactly
--       as it does on the three support tables. Every write goes through a
--       security definer RPC granted to service_role alone, and each RPC
--       re-checks the actor because service_role bypasses RLS.
--   (d) A turn's sources are validated by private.assistant_sources_valid at
--       write time, so a source without a human label cannot be stored. Rail 3
--       of the lane contract — no raw identifier on screen — is therefore a
--       property of the row rather than a habit of whichever component renders
--       it: `label` is required text and `ref` is an opaque handle the surface
--       passes back, never prints.
--
-- A platform admin can read every admin conversation and no operator one. That
-- is deliberate and it is the one place this schema does not follow
-- private.profile_can_access_support_thread, which gives a platform admin
-- everything. A support thread is a business record about a client; an
-- assistant conversation is the questions one person asked while working, and
-- reading a colleague's is a different product nobody has asked for.


-- ---------------------------------------------------------------------------
-- Part 1: the closed vocabularies.
-- ---------------------------------------------------------------------------

create type public.assistant_scope as enum (
  'operator',
  'admin'
);

create type public.assistant_turn_role as enum (
  'user',
  'assistant'
);


-- ---------------------------------------------------------------------------
-- Part 2: the source shape.
-- ---------------------------------------------------------------------------
--
-- A CHECK cannot contain a subquery, so per-element validation has to happen
-- inside a function — the same shape private.audit_meta_valid takes in
-- migration 003, and for the same reason.
--
-- The permitted kinds are a literal array here rather than an enum because
-- enum_range() is not immutable and an immutable function is what a CHECK
-- requires. `web/src/lib/assistant/types.ts` carries the same five labels, and
-- `supabase/tests/387_assistant_conversations.test.sql` proves the closure by
-- storing each one and being refused a sixth.
--
-- `label` is required and non-empty; `ref` may be null. That asymmetry is the
-- point: a source the surface cannot name is not a source it may render, and
-- the alternative — a null label with an id in it — is exactly the failure the
-- no-raw-identifiers rule exists to prevent.

create function private.assistant_sources_valid(p_sources jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  item_key text;
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(p_sources) > 12 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(p_sources) as value
  loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;

    for item_key in select key from jsonb_object_keys(item) as key
    loop
      if item_key not in ('kind', 'label', 'ref') then
        return false;
      end if;
    end loop;

    -- The `?` test comes first and is load-bearing. `item -> 'kind'` on an
    -- object with no `kind` key is SQL NULL, every comparison against it is
    -- NULL, and `if NULL then return false` never fires — so an element missing
    -- a key would validate. That is the shape a source with an id and no human
    -- label takes, which is the one thing this function exists to refuse.
    if not (item ? 'kind')
      or jsonb_typeof(item -> 'kind') <> 'string'
      or (item ->> 'kind') not in ('client', 'bank', 'article', 'operator', 'metric') then
      return false;
    end if;

    if not (item ? 'label')
      or jsonb_typeof(item -> 'label') <> 'string'
      or length(btrim(item ->> 'label')) not between 1 and 120 then
      return false;
    end if;

    if not (item ? 'ref') or jsonb_typeof(item -> 'ref') = 'null' then
      continue;
    end if;

    if jsonb_typeof(item -> 'ref') <> 'string'
      or length(btrim(item ->> 'ref')) not between 1 and 200 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.assistant_sources_valid(jsonb) from public, anon, authenticated;
grant execute on function private.assistant_sources_valid(jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- Part 3: conversations.
-- ---------------------------------------------------------------------------
--
-- The title is `not null` with a length cap that matches the 80 characters the
-- lane contract fixes, and it starts as a neutral placeholder that
-- assistant_append_turn replaces with the first question. Deriving it in SQL
-- rather than in the route means every writer produces the same title, and a
-- conversation cannot exist with a title somebody typed.

create table public.assistant_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  scope public.assistant_scope not null,
  profile_id uuid not null references public.profiles(id),
  org_id uuid references public.orgs(id),
  title text not null,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint assistant_conversations_title_length check (length(btrim(title)) between 1 and 80),
  constraint assistant_conversations_scope_org check (
    (scope = 'operator' and org_id is not null)
    or (scope = 'admin' and org_id is null)
  )
);

create index assistant_conversations_owner_idx
  on public.assistant_conversations(profile_id, last_activity_at desc);
create index assistant_conversations_scope_idx
  on public.assistant_conversations(scope, last_activity_at desc);


-- ---------------------------------------------------------------------------
-- Part 4: turns.
-- ---------------------------------------------------------------------------
--
-- assistant_turns_user_carries_no_source is worth its line: a question has no
-- provenance to cite, and allowing one would make a surface that renders source
-- chips under every turn quietly attribute the person's own words to a
-- document.

create table public.assistant_turns (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role public.assistant_turn_role not null,
  body text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint assistant_turns_body_length check (length(btrim(body)) between 1 and 8000),
  constraint assistant_turns_sources_shape check (private.assistant_sources_valid(sources)),
  constraint assistant_turns_user_carries_no_source check (
    role = 'assistant' or sources = '[]'::jsonb
  )
);

create index assistant_turns_conversation_idx
  on public.assistant_turns(conversation_id, created_at);


-- ---------------------------------------------------------------------------
-- Part 5: the access predicate, in the two regimes.
-- ---------------------------------------------------------------------------

create function private.profile_can_access_assistant_conversation(
  p_profile_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when conversation.scope = 'admin' then profile.role = 'platform_admin'
        else
          profile.role = 'operator_member'
          and conversation.profile_id = profile.id
          and conversation.org_id = profile.org_id
      end
      from public.assistant_conversations as conversation
      join public.profiles as profile on profile.id = p_profile_id
      where conversation.id = p_conversation_id
    ),
    false
  )
$$;

-- Wrapping the auth helper in (select …) is Supabase's documented guidance: the
-- planner evaluates it once per statement instead of once per row.
create function private.can_access_assistant_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_can_access_assistant_conversation(
    (select private.auth_profile_id()),
    p_conversation_id
  )
$$;

revoke all on function private.profile_can_access_assistant_conversation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.can_access_assistant_conversation(uuid)
  from public, anon, authenticated;
grant execute on function private.profile_can_access_assistant_conversation(uuid, uuid) to service_role;
grant execute on function private.can_access_assistant_conversation(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Part 6: grants and the two read policies.
-- ---------------------------------------------------------------------------
--
-- The absence is the mechanism, as it is on the support tables: `authenticated`
-- gets select and nothing else, so there are no write policies because there is
-- nothing for them to police.

alter table public.assistant_conversations enable row level security;
alter table public.assistant_conversations force row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_turns force row level security;

revoke all on table public.assistant_conversations from public, anon, authenticated;
revoke all on table public.assistant_turns from public, anon, authenticated;

grant select on table public.assistant_conversations to authenticated;
grant select on table public.assistant_turns to authenticated;

grant all on table public.assistant_conversations to service_role;
grant all on table public.assistant_turns to service_role;

-- Migration 374 swept TRUNCATE off every table that existed when it ran, on the
-- reasoning that no application-reachable role has any business holding it
-- anywhere. `grant all` above hands it straight back, so a table created after
-- that sweep has to take it off again — otherwise the boundary quietly develops
-- a hole one table wide every time somebody adds a table.
revoke truncate on table public.assistant_conversations from public, anon, authenticated, service_role;
revoke truncate on table public.assistant_turns from public, anon, authenticated, service_role;

-- The rest of migration 374's boundary treatment, which a table added after the
-- sweep has to apply to itself: no application-reachable role deletes from it,
-- and an ALWAYS statement guard refuses TRUNCATE even to a SECURITY DEFINER
-- function, which a revoked grant never would. A turn is deleted only with its conversation, through the cascade `assistant_delete_conversation` triggers; `assistant_conversations` itself stays outside the boundary because that function is a declared deletion path.
revoke delete on table public.assistant_turns from public, anon, authenticated, service_role;

create trigger assistant_turns_no_truncate
before truncate on public.assistant_turns
for each statement execute function public.append_only_guard();

alter table public.assistant_turns enable always trigger assistant_turns_no_truncate;

create policy assistant_conversations_select
on public.assistant_conversations
for select
to authenticated
using (private.can_access_assistant_conversation(id));

-- A turn carries no scope of its own. Checking the conversation is what makes
-- that safe, and it is the same shape support_messages_select takes against its
-- thread: one predicate, applied at the parent.
create policy assistant_turns_select
on public.assistant_turns
for select
to authenticated
using (private.can_access_assistant_conversation(conversation_id));


-- ---------------------------------------------------------------------------
-- Part 7: opening a conversation.
-- ---------------------------------------------------------------------------
--
-- Refusals, in order:
--
--   ASSISTANT_ACTOR_REQUIRED  p_actor_profile_id is null
--   ASSISTANT_ACTOR_UNKNOWN   no profile row matches
--   ASSISTANT_SCOPE_INVALID   the actor's role cannot hold that scope
--
-- The org comes from the actor's own profile and is never an argument, so one
-- tenant cannot open a conversation inside another. That is the same reasoning
-- migration 103 applied to a consumer's client id: an argument the caller
-- cannot influence is better than one that is checked afterwards.

create function public.assistant_open_conversation(
  p_scope public.assistant_scope,
  p_actor_profile_id uuid
)
returns public.assistant_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_conversation public.assistant_conversations;
begin
  if p_actor_profile_id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_REQUIRED';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = p_actor_profile_id;

  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_UNKNOWN';
  end if;

  if p_scope = 'operator' then
    if v_profile.role <> 'operator_member' or v_profile.org_id is null then
      raise exception using errcode = 'P0001', message = 'ASSISTANT_SCOPE_INVALID';
    end if;
  else
    if v_profile.role <> 'platform_admin' then
      raise exception using errcode = 'P0001', message = 'ASSISTANT_SCOPE_INVALID';
    end if;
  end if;

  insert into public.assistant_conversations (scope, profile_id, org_id, title)
  values (
    p_scope,
    p_actor_profile_id,
    case when p_scope = 'operator' then v_profile.org_id else null end,
    'New conversation'
  )
  returning * into strict v_conversation;

  return v_conversation;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 8: appending a turn.
-- ---------------------------------------------------------------------------
--
-- The title is derived here, on the first user turn, and never again. Doing it
-- on write rather than on read means the history list is a plain select and two
-- surfaces cannot disagree about what a conversation is called.
--
-- last_activity_at moves on every turn, including the assistant's, because the
-- history rail orders by it and a conversation whose answer arrived a minute ago
-- is more recent than one whose question did.

create function public.assistant_append_turn(
  p_conversation_id uuid,
  p_actor_profile_id uuid,
  p_role public.assistant_turn_role,
  p_body text,
  p_sources jsonb default '[]'::jsonb
)
returns public.assistant_turns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_conversation public.assistant_conversations;
  v_turn public.assistant_turns;
  v_sources jsonb := coalesce(p_sources, '[]'::jsonb);
begin
  if p_actor_profile_id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_REQUIRED';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = p_actor_profile_id;

  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_UNKNOWN';
  end if;

  if not private.profile_can_access_assistant_conversation(p_actor_profile_id, p_conversation_id) then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_FORBIDDEN';
  end if;

  select conversation.*
  into strict v_conversation
  from public.assistant_conversations as conversation
  where conversation.id = p_conversation_id
  for update;

  insert into public.assistant_turns (conversation_id, role, body, sources)
  values (p_conversation_id, p_role, p_body, v_sources)
  returning * into strict v_turn;

  -- "The first question" is read from the turns, not from whether the title
  -- still equals the placeholder. Comparing against the placeholder string would
  -- couple this function to a literal in part 7, and a person whose first
  -- question happened to be that literal would then have their second question
  -- overwrite the title.
  update public.assistant_conversations
  set last_activity_at = v_turn.created_at,
      title = case
        when p_role = 'user'
          and not exists (
            select 1
            from public.assistant_turns as earlier
            where earlier.conversation_id = p_conversation_id
              and earlier.role = 'user'
              and earlier.id <> v_turn.id
          )
          then left(btrim(p_body), 80)
        else v_conversation.title
      end
  where id = p_conversation_id;

  return v_turn;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 9: reads.
-- ---------------------------------------------------------------------------
--
-- message_count is derived rather than stored, for the same reason the support
-- unread count is: a stored count is a second copy of a fact the turns already
-- carry, and the copies drift.
--
-- p_conversation_id null means "every conversation this actor can see", so the
-- list and the single read are one query and cannot disagree.

create function public.assistant_list_conversations(
  p_actor_profile_id uuid,
  p_conversation_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  scope public.assistant_scope,
  title text,
  created_at timestamptz,
  last_activity_at timestamptz,
  message_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    conversation.scope,
    conversation.title,
    conversation.created_at,
    conversation.last_activity_at,
    (
      select count(*)::integer
      from public.assistant_turns as turn
      where turn.conversation_id = conversation.id
    )
  from public.assistant_conversations as conversation
  where p_actor_profile_id is not null
    and (p_conversation_id is null or conversation.id = p_conversation_id)
    and private.profile_can_access_assistant_conversation(p_actor_profile_id, conversation.id)
  order by conversation.last_activity_at desc
  limit greatest(coalesce(p_limit, 50), 0)
$$;

-- A conversation the actor cannot see and one that does not exist both return
-- zero rows, so the response cannot be used to probe for conversation ids.
create function public.assistant_list_turns(
  p_conversation_id uuid,
  p_actor_profile_id uuid,
  p_limit integer default 200
)
returns setof public.assistant_turns
language sql
stable
security definer
set search_path = ''
as $$
  select turn.*
  from public.assistant_turns as turn
  where turn.conversation_id = p_conversation_id
    and p_actor_profile_id is not null
    and private.profile_can_access_assistant_conversation(p_actor_profile_id, p_conversation_id)
  order by turn.created_at asc, turn.id asc
  limit greatest(coalesce(p_limit, 200), 0)
$$;


-- ---------------------------------------------------------------------------
-- Part 10: deleting a conversation.
-- ---------------------------------------------------------------------------
--
-- A hard delete, and the turns go with it through the cascade. This is a
-- person's own history and "delete" has to mean it; a soft-deleted row that
-- still holds the questions somebody asked would be the wrong answer to the
-- only reason anybody presses this button.

create function public.assistant_delete_conversation(
  p_conversation_id uuid,
  p_actor_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if p_actor_profile_id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_REQUIRED';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = p_actor_profile_id;

  if v_profile.id is null then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_ACTOR_UNKNOWN';
  end if;

  if not private.profile_can_access_assistant_conversation(p_actor_profile_id, p_conversation_id) then
    raise exception using errcode = 'P0001', message = 'ASSISTANT_FORBIDDEN';
  end if;

  delete from public.assistant_conversations
  where id = p_conversation_id;

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- Part 11: grants. service_role and nothing else.
-- ---------------------------------------------------------------------------

revoke all on function public.assistant_open_conversation(public.assistant_scope, uuid)
  from public, anon, authenticated;
revoke all on function public.assistant_append_turn(
  uuid, uuid, public.assistant_turn_role, text, jsonb
) from public, anon, authenticated;
revoke all on function public.assistant_list_conversations(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.assistant_list_turns(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.assistant_delete_conversation(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.assistant_open_conversation(public.assistant_scope, uuid) to service_role;
grant execute on function public.assistant_append_turn(
  uuid, uuid, public.assistant_turn_role, text, jsonb
) to service_role;
grant execute on function public.assistant_list_conversations(uuid, uuid, integer) to service_role;
grant execute on function public.assistant_list_turns(uuid, uuid, integer) to service_role;
grant execute on function public.assistant_delete_conversation(uuid, uuid) to service_role;
