-- R1C-02/R1C-15/R1D-02/R1D-05: stop analysis immediately and purge derived data durably.
--
-- The purge retains consents, consent revocations, e-signatures, enrollment/IDV/subscription
-- rows, audit and stage history, tracker transition receipts, applications/outcomes,
-- fees/payments, support threads, and paid refresh request/payment records. It deletes plans,
-- plan-derived checklist rows, analysis runs, non-success analysis jobs, and monitoring events,
-- and nulls uploaded derived features. The CRS member handle is cleared only after the caller
-- has completed the provider's idempotent close operation.

alter type public.analysis_job_status add value if not exists 'cancelled';

begin;

create or replace function private.analysis_authorized(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.enrollments as enrollment
    where enrollment.client_id = p_client_id
      and enrollment.status <> 'cancelled'
  ) and exists (
    select 1
    from public.consents as consent
    where consent.client_id = p_client_id
      and consent.kind = 'analysis'
      and consent.action = 'granted'
      and not exists (
        select 1
        from public.consent_revocations as revocation
        where revocation.consent_id = consent.id
      )
  );
$fn$;

create or replace function public.analysis_is_authorized(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.analysis_authorized(p_client_id);
$fn$;

create or replace function public.enrollment_cancel_sub(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_client_id uuid;
  v_cancelled_at timestamptz := pg_catalog.now();
  v_window text := pg_catalog.to_char(v_cancelled_at at time zone 'UTC', 'YYYY-MM-DD');
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select enrollment.client_id into v_client_id
  from public.enrollments as enrollment
  where enrollment.id = p_enrollment_id
  for update;

  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;

  update public.enrollments
  set status = 'cancelled',
      parked_until = null,
      updated_at = v_cancelled_at
  where id = p_enrollment_id
    and status <> 'cancelled';

  update public.consumer_subscriptions
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, v_cancelled_at),
      updated_at = v_cancelled_at
  where enrollment_id = p_enrollment_id;

  update public.analysis_jobs
  set status = 'cancelled',
      lease_owner = null,
      lease_until = null,
      error_code = null,
      updated_at = v_cancelled_at
  where client_id = v_client_id
    and status = 'queued';

  perform public.enqueue_background_job(
    'purge.derived',
    'enrollment:' || p_enrollment_id::text,
    v_window
  );

  -- p_reason remains intentionally excluded from unrestricted persistence and audit metadata.
end;
$fn$;

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

create or replace function public.enqueue_analysis_job(
  p_client_id uuid,
  p_source_kind public.analysis_job_source_kind,
  p_source_id uuid,
  p_trigger public.analysis_trigger
)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job public.analysis_jobs;
  v_inserted boolean := false;
begin
  if not private.analysis_authorized(p_client_id) then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_NOT_AUTHORIZED';
  end if;

  if p_source_kind = 'enrollment' then
    if p_trigger <> 'scheduled' or not exists (
      select 1 from public.enrollments as enrollment
      where enrollment.id = p_source_id and enrollment.client_id = p_client_id
        and enrollment.status <> 'cancelled'
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'monitoring_event' then
    if p_trigger <> 'alert' or not exists (
      select 1 from public.monitoring_events as event
      where event.id = p_source_id and event.client_id = p_client_id
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'document_upload' then
    if p_trigger <> 'upload' or not exists (
      select 1 from public.document_uploads as upload
      where upload.id = p_source_id
        and upload.client_id = p_client_id
        and upload.kind = 'credit_report'
        and upload.lifecycle = 'purged'
        and private.derived_features_valid(upload.derived_features)
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  elsif p_source_kind = 'force_pull' then
    if p_trigger <> 'force_pull' or not exists (
      select 1
      from public.paid_refresh_requests as request
      join public.paid_refresh_payment_events as payment_event
        on payment_event.request_id = request.id
       and payment_event.outcome = 'succeeded'
       and payment_event.amount_cents = request.amount_cents
       and payment_event.currency = request.currency
      where request.id = p_source_id
        and request.client_id = p_client_id
        and request.state in ('paid', 'queued')
    ) then
      raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ANALYSIS_SOURCE_INVALID';
  end if;

  insert into public.analysis_jobs (client_id, source_kind, source_id, trigger)
  values (p_client_id, p_source_kind, p_source_id, p_trigger)
  on conflict on constraint analysis_jobs_source_unique do nothing
  returning * into v_job;

  if v_job.id is not null then
    v_inserted := true;
  else
    select job_row.* into strict v_job
    from public.analysis_jobs as job_row
    where job_row.job = 'analysis.run'
      and job_row.subject = 'client:' || p_client_id::text
      and job_row.source_kind = p_source_kind
      and job_row.source_id = p_source_id;
  end if;

  if v_inserted then
    perform private.audit_analysis_job_transition(v_job, 'absent', 'queued');
  end if;
  return next v_job;
end;
$fn$;

alter table public.document_uploads
  drop constraint document_uploads_kind_shape;
alter table public.document_uploads
  add constraint document_uploads_kind_shape check (
    (
      kind = 'company'
      and section is not null
      and derived_features is null
      and lifecycle in ('pending', 'stored', 'failed')
    )
    or (
      kind = 'credit_report'
      and section is null
      and (
        (lifecycle in ('pending', 'stored', 'failed') and derived_features is null)
        or (lifecycle in ('parsed', 'delete_pending') and private.derived_features_valid(derived_features))
        or (lifecycle = 'purged' and (
          derived_features is null or private.derived_features_valid(derived_features)
        ))
      )
    )
  );

create or replace function public.purge_derived_enrollment(
  p_enrollment_id uuid,
  p_closed_member_ref text
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_client_id uuid;
  v_member_ref text;
  v_rows integer := 0;
  v_count integer;
begin
  select enrollment.client_id, enrollment.crs_member_ref
  into v_client_id, v_member_ref
  from public.enrollments as enrollment
  where enrollment.id = p_enrollment_id
  for update;

  if v_client_id is null then return 0; end if;
  if v_member_ref is not null and v_member_ref is distinct from p_closed_member_ref then
    raise exception using errcode = 'P0001', message = 'CRS_MEMBER_CLOSE_REQUIRED';
  end if;

  update public.enrollments
  set crs_member_ref = null,
      updated_at = pg_catalog.now()
  where id = p_enrollment_id and crs_member_ref is not null;

  delete from public.checklist_item_state where client_id = v_client_id;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  delete from public.checklist_items where client_id = v_client_id;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  delete from public.plans where client_id = v_client_id;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  delete from public.analysis_runs where client_id = v_client_id;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  delete from public.analysis_jobs
  where client_id = v_client_id and status not in ('succeeded', 'failed');
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  update public.document_uploads
  set derived_features = null,
      updated_at = pg_catalog.now()
  where client_id = v_client_id
    and kind = 'credit_report'
    and derived_features is not null;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;
  delete from public.monitoring_events where client_id = v_client_id;
  get diagnostics v_count = row_count; v_rows := v_rows + v_count;

  return v_rows;
end;
$fn$;

revoke all on function private.analysis_authorized(uuid) from public;
revoke all on function public.analysis_is_authorized(uuid) from public, anon, authenticated;
revoke all on function public.enrollment_cancel_sub(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.enrollment_revoke_consent(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger) from public, anon, authenticated;
revoke all on function public.purge_derived_enrollment(uuid,text) from public, anon, authenticated;
grant execute on function public.analysis_is_authorized(uuid) to service_role;
grant execute on function public.enrollment_cancel_sub(uuid,uuid,text) to service_role;
grant execute on function public.enrollment_revoke_consent(uuid,text,uuid) to service_role;
grant execute on function public.enqueue_analysis_job(uuid,public.analysis_job_source_kind,uuid,public.analysis_trigger) to service_role;
grant execute on function public.purge_derived_enrollment(uuid,text) to service_role;

commit;
