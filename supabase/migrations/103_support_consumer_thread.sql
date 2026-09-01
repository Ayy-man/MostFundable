-- Phase 13 · migration 103 — a consumer opening their own team chat.
--
-- One change to `public.support_open_thread`, replaced whole because plpgsql has no smaller unit.
-- Everything else in migration 101 stands; the diff against it is the `v_client_id` declaration,
-- the resolution block inside the `team_chat` branch, and three references that now read the
-- resolved value instead of the argument.
--
-- Why: with the flag on, the consumer surface has to be able to start the conversation, and the
-- only piece it is missing is its own client id. Sending that id to the browser purely so the
-- browser could send it back would widen what a client knows for no gain — a forged id would be
-- refused by the permission check either way, but the honest arrangement is that the consumer
-- never names a client at all. Every other caller still supplies one and is checked exactly as
-- before, and a consumer who somehow has no client row gets the same
-- SUPPORT_THREAD_SCOPE_INVALID a null id has always produced.
--
-- The permission check itself is untouched. This resolves an argument; it grants nothing.

create or replace function public.support_open_thread(
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
  v_client_id uuid := p_client_id;
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
    -- A consumer knows they are themselves and nothing else. Their client id is not something
    -- the browser holds, and handing it to the browser so it could hand it back would be a
    -- worse arrangement than resolving it here: this lookup is keyed on the actor's own profile,
    -- so it can only ever find the one row that already belongs to them. Every other caller
    -- still has to name the client, and the permission check below is unchanged for all of them.
    if p_client_id is null and v_profile.role = 'consumer' then
      select client.id
      into v_client_id
      from public.clients as client
      where client.consumer_profile_id = v_profile.id;
    else
      v_client_id := p_client_id;
    end if;

    if v_client_id is null then
      raise exception using errcode = 'P0001', message = 'SUPPORT_THREAD_SCOPE_INVALID';
    end if;

    select client.*
    into v_client
    from public.clients as client
    where client.id = v_client_id
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
    where thread.client_id = v_client_id
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
  values (p_kind, p_org_id, v_client_id, p_subject, p_actor_profile_id)
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
