begin;

set local search_path = public, extensions;

select plan(3);

select has_type(
  'public',
  'analysis_job_source_kind',
  'analysis source kind enum exists'
);

select enum_has_labels(
  'public',
  'analysis_job_source_kind',
  array['enrollment', 'monitoring_event', 'document_upload', 'force_pull'],
  'analysis source kinds preserve existing provenance and append force pull'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_enum as enum_value
    join pg_catalog.pg_type as enum_type on enum_type.oid = enum_value.enumtypid
    join pg_catalog.pg_namespace as enum_schema on enum_schema.oid = enum_type.typnamespace
    where enum_schema.nspname = 'public'
      and enum_type.typname = 'analysis_job_source_kind'
      and enum_value.enumlabel = 'force_pull'
  ),
  1,
  'force pull source kind exists exactly once'
);

select * from finish();

rollback;
