-- R3A-07: workspace fee defaults and legal evidence are operator governance data.

drop policy if exists org_fee_defaults_read on public.org_fee_defaults;
create policy org_fee_defaults_read
on public.org_fee_defaults
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'::public.app_role
  or (
    (select private.auth_app_role()) = 'operator_member'::public.app_role
    and org_id = (select private.auth_org_id())
  )
);

drop policy if exists org_flags_read on public.org_flags;
create policy org_flags_read
on public.org_flags
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'::public.app_role
  or (
    (select private.auth_app_role()) = 'operator_member'::public.app_role
    and org_id = (select private.auth_org_id())
  )
);
