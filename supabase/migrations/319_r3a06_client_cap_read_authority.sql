-- R3A-06: client-cap aggregates are operator/platform governance data.

create or replace function public.billing_read_client_cap(p_org_id uuid)
returns table(active_count integer, client_cap integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if (select auth.role()) = 'authenticated' then
    v_role := private.auth_app_role();
    if v_role = 'platform_admin'::public.app_role then
      null;
    elsif v_role = 'operator_member'::public.app_role
      and private.auth_org_id() = p_org_id
    then
      null;
    else
      raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN';
    end if;
  elsif (select auth.role()) <> 'service_role' then
    raise exception using errcode = '42501', message = 'CLIENT_CAP_READ_FORBIDDEN';
  end if;

  return query
  select * from private.billing_read_client_cap_r2a11_impl(p_org_id);
end;
$$;

revoke all on function public.billing_read_client_cap(uuid) from public, anon;
grant execute on function public.billing_read_client_cap(uuid) to authenticated, service_role;
