-- Durable workspace-controlled consumer portal and operator notification preferences.

begin;

alter table public.orgs
  add column portal_application_visibility text not null default 'details',
  add column portal_show_funding_progress boolean not null default true,
  add column portal_allow_document_uploads boolean not null default true,
  add column portal_show_trainings boolean not null default true,
  add column notification_email_holds boolean not null default true,
  add column notification_digest_enabled boolean not null default true,
  add column notification_digest_frequency text not null default 'weekly',
  add column notification_task_due boolean not null default true,
  add column notification_payment_failed boolean not null default true,
  add column notification_client_messages boolean not null default false,
  add constraint orgs_portal_application_visibility_valid
    check (portal_application_visibility in ('details', 'status-only')),
  add constraint orgs_notification_digest_frequency_valid
    check (notification_digest_frequency in ('daily', 'weekly', 'monthly'));

comment on column public.orgs.portal_application_visibility is
  'Workspace default for the consumer application surface; per-client overrides remain authoritative.';
comment on column public.orgs.portal_show_funding_progress is
  'Whether consumers see funding-goal progress on their overview.';
comment on column public.orgs.portal_allow_document_uploads is
  'Whether consumers may create document uploads; operators retain document access.';
comment on column public.orgs.portal_show_trainings is
  'Whether the workspace training library is exposed to consumers.';

create or replace function private.audit_org_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if old.assignment_mode is distinct from new.assignment_mode then v_fields := array_append(v_fields, 'assignment_mode'); end if;
  if old.default_client_goal_cents is distinct from new.default_client_goal_cents then v_fields := array_append(v_fields, 'default_client_goal_cents'); end if;
  if old.team_sees_all_clients is distinct from new.team_sees_all_clients then v_fields := array_append(v_fields, 'team_sees_all_clients'); end if;
  if old.portal_application_visibility is distinct from new.portal_application_visibility then v_fields := array_append(v_fields, 'portal_application_visibility'); end if;
  if old.portal_show_funding_progress is distinct from new.portal_show_funding_progress then v_fields := array_append(v_fields, 'portal_show_funding_progress'); end if;
  if old.portal_allow_document_uploads is distinct from new.portal_allow_document_uploads then v_fields := array_append(v_fields, 'portal_allow_document_uploads'); end if;
  if old.portal_show_trainings is distinct from new.portal_show_trainings then v_fields := array_append(v_fields, 'portal_show_trainings'); end if;
  if old.notification_email_holds is distinct from new.notification_email_holds then v_fields := array_append(v_fields, 'notification_email_holds'); end if;
  if old.notification_digest_enabled is distinct from new.notification_digest_enabled then v_fields := array_append(v_fields, 'notification_digest_enabled'); end if;
  if old.notification_digest_frequency is distinct from new.notification_digest_frequency then v_fields := array_append(v_fields, 'notification_digest_frequency'); end if;
  if old.notification_task_due is distinct from new.notification_task_due then v_fields := array_append(v_fields, 'notification_task_due'); end if;
  if old.notification_payment_failed is distinct from new.notification_payment_failed then v_fields := array_append(v_fields, 'notification_payment_failed'); end if;
  if old.notification_client_messages is distinct from new.notification_client_messages then v_fields := array_append(v_fields, 'notification_client_messages'); end if;
  if cardinality(v_fields) = 0 then return new; end if;

  insert into public.audit_log (
    org_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.id, (select auth.uid()), 'org.settings.updated', 'org', new.id,
    pg_catalog.clock_timestamp(), jsonb_build_object('field_names', to_jsonb(v_fields))
  );
  return new;
end;
$$;

revoke all on function private.audit_org_settings_change()
  from public, anon, authenticated, service_role;

drop trigger if exists orgs_audit_settings_change on public.orgs;
create trigger orgs_audit_settings_change
after update of
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

commit;
