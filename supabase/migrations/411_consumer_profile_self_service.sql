-- Consumer profile self-service with provider-confirmed email synchronization.

begin;

create or replace function public.consumer_update_profile(
  p_full_name text,
  p_phone text
)
returns table (full_name text, email text, phone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := pg_catalog.btrim(p_full_name);
  v_phone text := nullif(pg_catalog.btrim(p_phone), '');
  v_org_id uuid;
begin
  if v_actor is null or p_full_name is null or p_phone is null
    or char_length(v_name) < 1 or char_length(v_name) > 120
    or (
      v_phone is not null
      and (
        char_length(v_phone) < 7 or char_length(v_phone) > 32
        or v_phone !~ '^[0-9+(). -]+$'
      )
    )
  then
    raise exception using errcode = '22023', message = 'CONSUMER_PROFILE_INPUT_INVALID';
  end if;

  update public.profiles as profile
  set full_name = v_name,
      phone = v_phone
  where profile.id = v_actor
    and profile.role = 'consumer'
    and profile.org_id is not null
    and profile.disabled_at is null
  returning profile.org_id into v_org_id;

  if not found then
    raise exception using errcode = '42501', message = 'CONSUMER_PROFILE_FORBIDDEN';
  end if;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_org_id, v_actor, 'consumer.profile.updated', 'profile', v_actor,
    pg_catalog.clock_timestamp(),
    jsonb_build_object('field_names', jsonb_build_array('full_name', 'phone'))
  );

  return query
  select profile.full_name, profile.email, profile.phone
  from public.profiles as profile
  where profile.id = v_actor;
end;
$$;

revoke all on function public.consumer_update_profile(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consumer_update_profile(text, text)
  to authenticated;

create or replace function private.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(new.email));
  v_org_id uuid;
begin
  if old.email is not distinct from new.email then return new; end if;
  if new.email is null then return new; end if;
  if v_email = '' or char_length(v_email) > 320 then
    raise exception using errcode = '22023', message = 'PROFILE_EMAIL_INVALID';
  end if;

  update public.profiles as profile
  set email = v_email
  where profile.id = new.id
  returning profile.org_id into v_org_id;

  if found then
    insert into public.audit_log (
      org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      v_org_id, new.id, 'profile.email.confirmed', 'profile', new.id,
      pg_catalog.clock_timestamp(),
      jsonb_build_object('field_names', jsonb_build_array('email'))
    );
  end if;
  return new;
end;
$$;

revoke all on function private.sync_profile_email_from_auth()
  from public, anon, authenticated, service_role;

drop trigger if exists auth_users_sync_profile_email on auth.users;
create trigger auth_users_sync_profile_email
after update of email on auth.users
for each row execute function private.sync_profile_email_from_auth();

commit;
