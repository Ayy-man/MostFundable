-- 391_consumer_checklist_reporting.sql — the consumer Optimization view's write path.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- Migration 003 gave a signed-in session `select` on the three checklist tables
-- and nothing else, so every write to `public.checklist_item_state` since has
-- been a service_role write. That is correct for the pipeline, which verifies a
-- factor against an analysis run, and wrong for the one thing a consumer is
-- entitled to say about their own file: "I did this, go and look". This file
-- opens exactly that much and no more.
--
-- The shape of "no more" is worth stating, because it is the whole security
-- argument and none of it rests on the caller being careful:
--
--   (a) The caller names a TEMPLATE KEY, never a client id, never an item id and
--       never a state row. There is no argument on this function that could
--       address another consumer's record, so the cross-client case is not
--       defended against — it is unrepresentable. The client is resolved from
--       `auth.uid()` through `clients.consumer_profile_id`, which carries a
--       UNIQUE constraint, so the resolution yields at most one row by
--       construction rather than by a LIMIT we remembered to write.
--   (b) The two template keys are hard-coded here. A template that some later
--       migration seeds — an operator-authored checklist, a document request, a
--       verification the pipeline owns — is not reportable by a consumer until
--       somebody adds its key to this list on purpose, in a migration a reviewer
--       reads. An allow-list that a consumer could grow by inserting a row would
--       not be an allow-list.
--   (c) The only transitions are `todo -> reported` and `reported -> todo`.
--       `verifying` and `verified` are the analysis pipeline's words about
--       evidence it has seen; a consumer un-saying them would be a consumer
--       editing what the file shows, which is the line this product does not
--       cross. Anything else raises, including `reported -> reported`: the
--       surface re-renders from the server after every call, so a second click
--       on a stale button is a stale caller and deserves to be told so rather
--       than silently rewriting a timestamp.
--   (d) `undo` clears `reported_at` rather than keeping it, because
--       `checklist_item_state_shape_check` requires a `todo` row to carry no
--       timestamps at all. The constraint is the authority on that, not this
--       function.
--
-- One grant, at the bottom: `execute` to `authenticated`. No table grant moves,
-- no policy changes, and service_role is deliberately NOT granted execute —
-- nothing on the server side needs this entry point, and a service_role caller
-- would be a caller with no `auth.uid()` to resolve a client from.


create function public.report_checklist_item(
  p_template_key text,
  p_action text
)
returns public.checklist_item_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_role public.app_role;
  v_client_id uuid;
  v_item_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_state public.checklist_item_state;
  v_template public.checklist_templates;
begin
  -- 1. The action vocabulary. Checked before anything is read, so a typo can
  --    never reach a row and can never be reported as a permission problem.
  if p_action is null or p_action not in ('report', 'undo') then
    raise exception using errcode = '22023', message = 'CHECKLIST_ACTION_INVALID';
  end if;

  -- 2. The allow-list. Hard-coded in SQL: see (b) above.
  if p_template_key is null
    or p_template_key not in ('utilization-under-thirty', 'business-profile-complete') then
    raise exception using errcode = '22023', message = 'CHECKLIST_TEMPLATE_NOT_REPORTABLE';
  end if;

  -- 3. The actor. `auth.role()` is checked as well as `auth.uid()` because a
  --    SECURITY DEFINER function runs as its owner: without this, a future
  --    caller reached through some other definer function would arrive with no
  --    JWT and fall through to whatever `auth.uid()` returned then.
  if (select auth.role()) <> 'authenticated' then
    raise exception using errcode = '42501', message = 'CHECKLIST_ACTOR_REQUIRED';
  end if;
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception using errcode = '42501', message = 'CHECKLIST_ACTOR_REQUIRED';
  end if;

  select profile.role
  into v_actor_role
  from public.profiles as profile
  where profile.id = v_actor;

  if v_actor_role is distinct from 'consumer'::public.app_role then
    raise exception using errcode = '42501', message = 'CHECKLIST_FORBIDDEN';
  end if;

  -- 4. The client, resolved rather than accepted. `clients.consumer_profile_id`
  --    is UNIQUE, so this is at most one row; `status = 'active'` matches the
  --    read path's own predicate, so a consumer cannot write to a record they
  --    would not be shown.
  select client.id
  into v_client_id
  from public.clients as client
  where client.consumer_profile_id = v_actor
    and client.status = 'active'::public.client_status;

  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'CHECKLIST_CLIENT_NOT_FOUND';
  end if;

  -- The second predicate over the same fact, matching the read path: the
  -- resolution above and this policy predicate are each sufficient and neither
  -- is load-bearing alone.
  if not (select private.can_access_client(v_client_id)) then
    raise exception using errcode = '42501', message = 'CHECKLIST_FORBIDDEN';
  end if;

  -- 5. The template row. `checklist_templates` is unique on (kind, key) rather
  --    than on key, so a key matching two rows is a real possibility and is
  --    refused rather than resolved arbitrarily by an implicit first-row pick.
  begin
    select template.*
    into strict v_template
    from public.checklist_templates as template
    where template.key = p_template_key;
  exception
    when no_data_found or too_many_rows then
      raise exception using errcode = 'P0002', message = 'CHECKLIST_TEMPLATE_UNKNOWN';
  end;

  select item.id
  into v_item_id
  from public.checklist_items as item
  where item.client_id = v_client_id
    and item.template_id = v_template.id;

  if p_action = 'undo' then
    -- Nothing to undo without an item: an undo that creates the row it is about
    -- to walk back would be a write dressed as a reversal.
    if v_item_id is null then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_TRANSITION_FORBIDDEN';
    end if;
  elsif v_item_id is null then
    -- 6. `report` materialises the item from its template. The title, blocking
    --    flag and sort order come from the template row rather than from the
    --    caller, so a consumer cannot author a line of their own checklist.
    insert into public.checklist_items (client_id, template_id, title, blocking, sort_order)
    values (v_client_id, v_template.id, v_template.title, v_template.blocking, v_template.sort_order)
    on conflict (client_id, template_id) do nothing
    returning id into v_item_id;

    -- The conflict arm returns no row, so a concurrent first report is read back
    -- rather than treated as a failure.
    if v_item_id is null then
      select item.id
      into v_item_id
      from public.checklist_items as item
      where item.client_id = v_client_id
        and item.template_id = v_template.id;
    end if;
  end if;

  -- 7. The state row, locked. Two clicks racing each other serialise here, so
  --    the second one sees the first one's state and is refused by the
  --    transition rule below rather than overwriting it.
  select item_state.*
  into v_state
  from public.checklist_item_state as item_state
  where item_state.checklist_item_id = v_item_id
  for update;

  if p_action = 'report' then
    if v_state.checklist_item_id is null then
      insert into public.checklist_item_state (checklist_item_id, client_id, state, reported_at)
      values (v_item_id, v_client_id, 'reported'::public.checklist_state, v_now)
      returning * into v_state;
      return v_state;
    end if;

    if v_state.state <> 'todo'::public.checklist_state then
      raise exception using errcode = 'P0001', message = 'CHECKLIST_TRANSITION_FORBIDDEN';
    end if;

    update public.checklist_item_state
    set state = 'reported'::public.checklist_state,
        reported_at = v_now
    where checklist_item_id = v_item_id
    returning * into v_state;
    return v_state;
  end if;

  -- p_action = 'undo'.
  if v_state.checklist_item_id is null
    or v_state.state <> 'reported'::public.checklist_state then
    raise exception using errcode = 'P0001', message = 'CHECKLIST_TRANSITION_FORBIDDEN';
  end if;

  update public.checklist_item_state
  set state = 'todo'::public.checklist_state,
      reported_at = null,
      verifying_at = null,
      verified_at = null,
      verified_by_run_id = null
  where checklist_item_id = v_item_id
  returning * into v_state;
  return v_state;
end;
$$;

comment on function public.report_checklist_item(text, text) is
  'Lets a signed-in consumer mark one allow-listed checklist template on their own active client '
  'record as reported, or walk that back. Resolves the client from auth.uid(); accepts no client, '
  'item or state identifier; refuses every transition except todo<->reported.';

revoke all on function public.report_checklist_item(text, text) from public, anon;
grant execute on function public.report_checklist_item(text, text) to authenticated;
