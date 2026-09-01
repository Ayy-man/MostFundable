-- R1C-15/R1D-02: preserve the revocation transaction while setting its deferred purge time.

create or replace function public.enrollment_revoke_consent(
  p_client_id uuid,
  p_kind text,
  p_actor_id uuid
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_consent_id uuid;
  v_enrollment_id uuid;
  v_revoked_at timestamptz;
  v_due_at timestamptz;
  v_window text;
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select consent.id into v_consent_id
  from public.consents as consent
  where consent.client_id = p_client_id
    and consent.kind = p_kind::public.consent_kind
    and consent.action = 'granted'
    and not exists (
      select 1 from public.consent_revocations as revocation
      where revocation.consent_id = consent.id
    )
  order by consent.signed_at desc, consent.created_at desc, consent.id desc
  limit 1
  for update;

  if v_consent_id is not null then
    insert into public.consent_revocations (
      consent_id, client_id, kind, revoked_by
    ) values (
      v_consent_id, p_client_id, p_kind, p_actor_id
    )
    on conflict (consent_id) do nothing
    returning revoked_at into v_revoked_at;
  end if;

  if p_kind <> 'analysis' then return; end if;

  if v_revoked_at is null then
    select revocation.revoked_at into v_revoked_at
    from public.consent_revocations as revocation
    where revocation.client_id = p_client_id
      and revocation.kind = 'analysis'
    order by revocation.revoked_at desc, revocation.id desc
    limit 1;
  end if;

  if v_revoked_at is null then return; end if;

  update public.analysis_jobs
  set status = 'cancelled',
      lease_owner = null,
      lease_until = null,
      error_code = null,
      updated_at = pg_catalog.now()
  where client_id = p_client_id
    and status = 'queued';

  select enrollment.id into v_enrollment_id
  from public.enrollments as enrollment
  where enrollment.client_id = p_client_id;

  if v_enrollment_id is not null then
    v_due_at := v_revoked_at + interval '30 days';
    v_window := pg_catalog.to_char(v_due_at at time zone 'UTC', 'YYYY-MM-DD');
    perform public.enqueue_background_job(
      'purge.derived',
      'enrollment:' || v_enrollment_id::text,
      v_window
    );
    update public.background_jobs
    set available_at = greatest(available_at, v_due_at),
        updated_at = pg_catalog.now()
    where job = 'purge.derived'
      and subject = 'enrollment:' || v_enrollment_id::text
      and "window" = v_window
      and status = 'queued';
  end if;
end;
$fn$;

revoke all on function public.enrollment_revoke_consent(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.enrollment_revoke_consent(uuid,text,uuid)
  to service_role;
