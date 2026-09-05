begin;

alter table public.background_jobs
  drop constraint background_jobs_job_valid;

alter table public.background_jobs
  add constraint background_jobs_job_valid check (job in (
    'crs.alert_batch',
    'analysis.run',
    'billing.accruals',
    'outcomes.refresh_stats',
    'vault.sync_banks',
    'vault.reimport_kb',
    'purge.derived',
    'purge.uploaded_reports',
    'notifications.dispatch',
    'tenancy.trial_expiry',
    'kpi.rollup'
  ));

commit;
