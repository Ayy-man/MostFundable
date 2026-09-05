begin;

set local search_path = public, extensions;

select plan(4);

select has_type(
  'public',
  'analysis_job_source_kind',
  'analysis source kind enum exists'
);

select enum_has_labels(
  'public',
  'analysis_job_source_kind',
  array['enrollment', 'monitoring_event', 'document_upload', 'force_pull'],
  'analysis source kind preserves existing values through the paid refresh extension'
);

select has_type(
  'public',
  'outcome_notification_kind',
  'outcome notification kind enum exists'
);

select enum_has_labels(
  'public',
  'outcome_notification_kind',
  array['outcome_review_approved', 'outcome_review_removed', 'crs_alert', 'stage_change', 'analysis_complete', 'refresh_result', 'enrollment_milestone', 'document', 'team_message'],
  'notification kind preserves both existing values, the CRS alert kind and the migration 440 consumer event kinds'
);

select * from finish();

rollback;
