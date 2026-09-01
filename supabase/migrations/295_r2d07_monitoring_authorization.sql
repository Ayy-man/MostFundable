-- R2D-07: monitoring authorization follows the latest grant or withdrawal event.

create or replace function private.monitoring_authorized(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.enrollments e where e.client_id=p_client_id and e.status <> 'cancelled'
  ) and coalesce((
    select event.authorized from (
      select c.signed_at occurred_at, true authorized, c.id from public.consents c
      where c.client_id=p_client_id and c.kind='monitoring' and c.action='granted'
      union all
      select r.revoked_at, false, r.id from public.consent_revocations r
      where r.client_id=p_client_id and r.kind='monitoring'
    ) event order by event.occurred_at desc, event.authorized asc, event.id desc limit 1
  ),false);
$fn$;

create or replace function public.monitoring_is_authorized(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select private.monitoring_authorized(p_client_id);
$fn$;

revoke all on function private.monitoring_authorized(uuid) from public,anon,authenticated,service_role;
revoke all on function public.monitoring_is_authorized(uuid) from public,anon,authenticated;
grant execute on function public.monitoring_is_authorized(uuid) to service_role;
