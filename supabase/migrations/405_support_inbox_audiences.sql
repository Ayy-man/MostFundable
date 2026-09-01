-- Keep the two operator inboxes honest. Client replies and internal notes are
-- different message audiences, and archived demo-reset threads are retained as
-- evidence without remaining in the active support queue.

create or replace function public.support_list_threads(
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
    and (
      thread.kind <> 'team_chat'
      or exists (
        select 1
        from public.clients as client
        where client.id = thread.client_id
          and client.status = 'active'
      )
    )
  order by thread.last_activity_at desc
  limit greatest(coalesce(p_limit, 100), 0)
$$;

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
  counterpart_read_at timestamptz,
  participant_message_count integer,
  internal_message_count integer,
  last_participant_message_preview text,
  last_internal_message_preview text
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
    ),
    (
      select count(*)::integer
      from public.support_messages as message
      where message.thread_id = thread.id
        and message.visibility = 'participants'
    ),
    case when private.profile_sees_internal_support_notes(p_actor_profile_id) then (
      select count(*)::integer
      from public.support_messages as message
      where message.thread_id = thread.id
        and message.visibility = 'internal'
    ) else 0 end,
    (
      select left(btrim(message.body), 140)
      from public.support_messages as message
      where message.thread_id = thread.id
        and message.visibility = 'participants'
      order by message.sent_at desc, message.id desc
      limit 1
    ),
    case when private.profile_sees_internal_support_notes(p_actor_profile_id) then (
      select left(btrim(message.body), 140)
      from public.support_messages as message
      where message.thread_id = thread.id
        and message.visibility = 'internal'
      order by message.sent_at desc, message.id desc
      limit 1
    ) else null end
  from public.support_threads as thread
  left join public.support_thread_reads as mark
    on mark.thread_id = thread.id
   and mark.profile_id = p_actor_profile_id
  where p_actor_profile_id is not null
    and (p_thread_id is null or thread.id = p_thread_id)
    and private.profile_can_access_support_thread(p_actor_profile_id, thread.id)
    and (
      thread.kind <> 'team_chat'
      or exists (
        select 1
        from public.clients as client
        where client.id = thread.client_id
          and client.status = 'active'
      )
    )
  order by thread.last_activity_at desc
  limit greatest(coalesce(p_limit, 100), 0)
$$;

revoke all on function public.support_list_threads(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.support_list_thread_digest(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.support_list_threads(uuid, integer) to service_role;
grant execute on function public.support_list_thread_digest(uuid, uuid, integer) to service_role;
