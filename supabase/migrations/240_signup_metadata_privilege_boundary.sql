-- R1A-01: caller-writable signup metadata must never create a privileged profile.
-- Role and organization bindings may come only from raw_app_meta_data, which is
-- controlled by the auth admin/service path. Invite acceptance remains the
-- separate governed path for binding an initially unbound consumer profile.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_metadata jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_user_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app_role public.app_role;
  v_member_role public.org_role;
  v_org uuid;
  v_full_name text;
  v_email text;
begin
  begin
    v_app_role := (v_app_metadata ->> 'app_role')::public.app_role;
  exception
    when others then
      v_app_role := null;
  end;

  begin
    v_member_role := (v_app_metadata ->> 'org_role')::public.org_role;
  exception
    when others then
      v_member_role := null;
  end;

  begin
    v_org := (v_app_metadata ->> 'org_id')::uuid;
  exception
    when others then
      v_org := null;
  end;

  if v_org is not null
    and not exists (
      select 1 from public.orgs as organization where organization.id = v_org
    )
  then
    v_org := null;
  end if;

  if v_app_role is null then
    v_app_role := 'consumer'::public.app_role;
    v_org := null;
    v_member_role := null;
  elsif v_app_role = 'platform_admin'::public.app_role then
    v_org := null;
    v_member_role := null;
  elsif v_app_role = 'operator_member'::public.app_role then
    if v_org is null or v_member_role is null then
      v_app_role := 'consumer'::public.app_role;
      v_org := null;
      v_member_role := null;
    end if;
  else
    v_member_role := null;
  end if;

  v_email := coalesce(new.email, '');
  v_full_name := coalesce(
    nullif(btrim(v_user_metadata ->> 'full_name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Member'
  );

  insert into public.profiles (
    id,
    role,
    org_id,
    org_role,
    full_name,
    email
  )
  values (
    new.id,
    v_app_role,
    v_org,
    v_member_role,
    v_full_name,
    v_email
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- Signup availability is preserved; the bootstrap route remains the
    -- corrector when profile creation encounters an unexpected database error.
    return new;
end;
$$;

comment on function public.handle_new_user() is
  'Bootstrap guarantor: caller metadata supplies display text only; privileged role and organization bindings require server-controlled app metadata or a governed RPC.';

revoke all on function public.handle_new_user() from public;
