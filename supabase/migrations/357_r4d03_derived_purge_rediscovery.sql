-- R4D-03: make the derived-purge obligation rediscoverable after a tuple dies.
--
-- `purge.derived` declares a daily cadence in the frozen JOB_DEFINITIONS but had only a
-- handler, so the drainer's three-attempt cap was the entire lifetime of the obligation and
-- `enqueue_background_job`'s conflict-ignore handed the same dead row back for the same
-- window. This adds the discovery query a cadence provider needs. It writes nothing and
-- returns metadata only (enrollment ids) — `enqueue_background_job` stays the sole writer,
-- so tuple validation, the owner-flag filter and enqueue idempotency are unchanged.
--
-- The residue definition mirrors what `public.purge_derived_enrollment` (260, extended by
-- 292) actually clears, so a target disappears from the selector exactly when the purge has
-- finished with it and nothing is rediscovered forever.

begin;

-- What the derived purge itself still has left to do for this enrollment.
create or replace function private.derived_purge_data_outstanding(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.enrollments as enrollment
    where enrollment.id = p_enrollment_id
      and (
        enrollment.crs_member_ref is not null
        or exists (select 1 from public.checklist_item_state as row_value where row_value.client_id = enrollment.client_id)
        or exists (select 1 from public.checklist_items as row_value where row_value.client_id = enrollment.client_id)
        or exists (select 1 from public.plans as row_value where row_value.client_id = enrollment.client_id)
        or exists (select 1 from public.analysis_runs as row_value where row_value.client_id = enrollment.client_id)
        or exists (
          select 1 from public.analysis_jobs as row_value
          where row_value.client_id = enrollment.client_id
            and row_value.status not in ('succeeded', 'failed')
        )
        or exists (select 1 from public.monitoring_events as row_value where row_value.client_id = enrollment.client_id)
        or exists (
          select 1 from public.document_uploads as row_value
          where row_value.client_id = enrollment.client_id
            and row_value.kind = 'credit_report'
            and row_value.derived_features is not null
        )
      )
  );
$fn$;

-- The composite the selector reads, and the only place another obligation carried by the
-- same job key belongs: a later forward migration replaces this body with
-- `select private.derived_purge_data_outstanding($1) or <its own condition>` without
-- restating the data predicate above.
create or replace function private.derived_purge_outstanding(p_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select private.derived_purge_data_outstanding(p_enrollment_id);
$fn$;

-- Metadata only. `p_stale_before` is the caller's age guard, so an enrollment a tuple is
-- currently working is not re-enqueued under a fresh window.
create or replace function public.list_derived_purge_targets(
  p_stale_before timestamptz,
  p_limit integer default 500
)
returns table (enrollment_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select enrollment.id
  from public.enrollments as enrollment
  where enrollment.updated_at < p_stale_before
    and (
      enrollment.status = 'cancelled'
      or exists (
        select 1
        from public.consent_revocations as revocation
        where revocation.client_id = enrollment.client_id
          and revocation.kind = 'analysis'
          and revocation.revoked_at + interval '30 days' <= pg_catalog.now()
      )
    )
    and private.derived_purge_outstanding(enrollment.id)
  order by enrollment.updated_at, enrollment.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$fn$;

revoke all on function private.derived_purge_data_outstanding(uuid) from public, anon, authenticated, service_role;
revoke all on function private.derived_purge_outstanding(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_derived_purge_targets(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_derived_purge_targets(timestamptz, integer) to service_role;

commit;
