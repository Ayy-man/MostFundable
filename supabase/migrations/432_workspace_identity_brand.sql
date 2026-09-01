-- Durable Workspace Setup identity. Organization identity stays on `orgs`,
-- while the portal-facing label remains part of the existing brand JSON.

begin;

alter table public.orgs
  add constraint orgs_name_bounded_trimmed
    check (
      pg_catalog.char_length(name) between 1 and 120
      and name = pg_catalog.btrim(name)
    ),
  add constraint orgs_brand_portal_name_valid
    check (
      not (brand ? 'portalName')
      or (
        pg_catalog.jsonb_typeof(brand -> 'portalName') = 'string'
        and pg_catalog.char_length(brand ->> 'portalName') between 1 and 120
        and brand ->> 'portalName' = pg_catalog.btrim(brand ->> 'portalName')
      )
    );

comment on constraint orgs_name_bounded_trimmed on public.orgs is
  'Workspace names are non-empty, bounded, and stored without surrounding spaces.';
comment on constraint orgs_brand_portal_name_valid on public.orgs is
  'The optional published-brand portalName is a non-empty bounded trimmed string.';

create or replace function private.audit_org_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if old.name is distinct from new.name then v_fields := pg_catalog.array_append(v_fields, 'name'); end if;
  if old.assignment_mode is distinct from new.assignment_mode then v_fields := pg_catalog.array_append(v_fields, 'assignment_mode'); end if;
  if old.default_client_goal_cents is distinct from new.default_client_goal_cents then v_fields := pg_catalog.array_append(v_fields, 'default_client_goal_cents'); end if;
  if old.team_sees_all_clients is distinct from new.team_sees_all_clients then v_fields := pg_catalog.array_append(v_fields, 'team_sees_all_clients'); end if;
  if old.portal_application_visibility is distinct from new.portal_application_visibility then v_fields := pg_catalog.array_append(v_fields, 'portal_application_visibility'); end if;
  if old.portal_show_funding_progress is distinct from new.portal_show_funding_progress then v_fields := pg_catalog.array_append(v_fields, 'portal_show_funding_progress'); end if;
  if old.portal_allow_document_uploads is distinct from new.portal_allow_document_uploads then v_fields := pg_catalog.array_append(v_fields, 'portal_allow_document_uploads'); end if;
  if old.portal_show_trainings is distinct from new.portal_show_trainings then v_fields := pg_catalog.array_append(v_fields, 'portal_show_trainings'); end if;
  if old.notification_email_holds is distinct from new.notification_email_holds then v_fields := pg_catalog.array_append(v_fields, 'notification_email_holds'); end if;
  if old.notification_digest_enabled is distinct from new.notification_digest_enabled then v_fields := pg_catalog.array_append(v_fields, 'notification_digest_enabled'); end if;
  if old.notification_digest_frequency is distinct from new.notification_digest_frequency then v_fields := pg_catalog.array_append(v_fields, 'notification_digest_frequency'); end if;
  if old.notification_task_due is distinct from new.notification_task_due then v_fields := pg_catalog.array_append(v_fields, 'notification_task_due'); end if;
  if old.notification_payment_failed is distinct from new.notification_payment_failed then v_fields := pg_catalog.array_append(v_fields, 'notification_payment_failed'); end if;
  if old.notification_client_messages is distinct from new.notification_client_messages then v_fields := pg_catalog.array_append(v_fields, 'notification_client_messages'); end if;
  if pg_catalog.cardinality(v_fields) = 0 then return new; end if;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.id, (select auth.uid()), 'org.settings.updated', 'org', new.id,
    pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object('field_names', pg_catalog.to_jsonb(v_fields))
  );
  return new;
end;
$$;

revoke all on function private.audit_org_settings_change()
  from public, anon, authenticated, service_role;

drop trigger if exists orgs_audit_settings_change on public.orgs;
create trigger orgs_audit_settings_change
after update of
  name,
  assignment_mode,
  default_client_goal_cents,
  team_sees_all_clients,
  portal_application_visibility,
  portal_show_funding_progress,
  portal_allow_document_uploads,
  portal_show_trainings,
  notification_email_holds,
  notification_digest_enabled,
  notification_digest_frequency,
  notification_task_due,
  notification_payment_failed,
  notification_client_messages
on public.orgs
for each row execute function private.audit_org_settings_change();

-- Keep the existing trusted-server signature and merge semantics. This adds
-- validation and a fixed-action audit only when the new portal label changes.
create or replace function public.tenancy_update_brand(
  p_org_id uuid,
  p_brand jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_brand jsonb;
  v_patch jsonb := p_brand;
  v_portal_name text;
  v_previous_portal_name text;
begin
  if not private.tenancy_actor_can_manage_org(p_actor_id, p_org_id) then
    raise exception using errcode = '42501', message = 'TENANT_ORG_ADMIN_REQUIRED';
  end if;
  if p_brand is null or pg_catalog.jsonb_typeof(p_brand) <> 'object' then
    raise exception using errcode = '22023', message = 'TENANT_BRAND_INVALID';
  end if;

  if p_brand ? 'portalName' then
    if pg_catalog.jsonb_typeof(p_brand -> 'portalName') <> 'string' then
      raise exception using errcode = '22023', message = 'TENANT_BRAND_INVALID';
    end if;
    v_portal_name := pg_catalog.btrim(p_brand ->> 'portalName');
    if pg_catalog.char_length(v_portal_name) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'TENANT_BRAND_INVALID';
    end if;
    v_patch := p_brand || pg_catalog.jsonb_build_object('portalName', v_portal_name);
  end if;

  select organization.brand
  into v_brand
  from public.orgs as organization
  where organization.id = p_org_id
  for update;

  if v_brand is null then
    raise exception using errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  end if;

  v_previous_portal_name := v_brand ->> 'portalName';
  v_brand := v_brand || v_patch;
  update public.orgs set brand = v_brand where id = p_org_id;

  if v_previous_portal_name is distinct from v_brand ->> 'portalName' then
    insert into public.audit_log (
      org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      p_org_id, p_actor_id, 'org.brand_updated', 'org', p_org_id,
      pg_catalog.clock_timestamp(),
      pg_catalog.jsonb_build_object(
        'field_names', pg_catalog.jsonb_build_array('portalName'),
        'source', 'tenancy'
      )
    );
  end if;

  return v_brand;
end;
$fn$;

revoke all on function public.tenancy_update_brand(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.tenancy_update_brand(uuid, jsonb, uuid)
  to service_role;

commit;
