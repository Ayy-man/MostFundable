-- R2A-06: withdrawal revokes every effective grant and authorization follows the latest event.

create or replace function private.analysis_authorized(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.enrollments as enrollment
    where enrollment.client_id = p_client_id and enrollment.status <> 'cancelled'
  ) and coalesce((
    select event.authorized
    from (
      select consent.signed_at as occurred_at, true as authorized, consent.id
      from public.consents as consent
      where consent.client_id = p_client_id and consent.kind = 'analysis' and consent.action = 'granted'
      union all
      select revocation.revoked_at, false, revocation.id
      from public.consent_revocations as revocation
      where revocation.client_id = p_client_id and revocation.kind = 'analysis'
    ) as event
    order by event.occurred_at desc, event.authorized asc, event.id desc
    limit 1
  ), false);
$fn$;

alter function public.enrollment_revoke_consent(uuid, text, uuid)
  rename to enrollment_revoke_consent_r2a06_base;
alter function public.enrollment_revoke_consent_r2a06_base(uuid, text, uuid)
  set schema private;

create or replace function public.enrollment_revoke_consent(
  p_client_id uuid,
  p_kind text,
  p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform pg_catalog.set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  perform 1 from public.clients where id = p_client_id for update;
  insert into public.consent_revocations(consent_id, client_id, kind, revoked_by)
  select consent.id, p_client_id, p_kind, p_actor_id
  from public.consents as consent
  where consent.client_id = p_client_id
    and consent.kind = p_kind::public.consent_kind
    and consent.action = 'granted'
    and not exists (
      select 1 from public.consent_revocations as existing where existing.consent_id = consent.id
    )
  on conflict (consent_id) do nothing;
  perform private.enrollment_revoke_consent_r2a06_base(p_client_id, p_kind, p_actor_id);
end
$fn$;

revoke all on function private.enrollment_revoke_consent_r2a06_base(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.enrollment_revoke_consent(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.enrollment_revoke_consent(uuid, text, uuid) to service_role;
