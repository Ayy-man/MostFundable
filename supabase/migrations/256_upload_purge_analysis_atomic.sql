-- R1C-12: mark a report purged and enqueue its exact analysis tuple atomically.

create function public.mark_purged_and_enqueue_analysis(p_upload_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.document_uploads;
begin
  select upload.* into v_upload
  from public.document_uploads as upload
  where upload.id = p_upload_id
  for update;

  if v_upload.id is null
     or v_upload.kind <> 'credit_report'
     or v_upload.lifecycle not in ('parsed', 'delete_pending', 'purged')
     or not private.derived_features_valid(v_upload.derived_features) then
    raise exception using errcode = 'P0001', message = 'UPLOAD_PURGE_SOURCE_INVALID';
  end if;

  if v_upload.lifecycle <> 'purged' then
    update public.document_uploads
    set lifecycle = 'purged', failure_code = null,
        purged_at = coalesce(purged_at, clock_timestamp()), updated_at = clock_timestamp()
    where id = p_upload_id;
  end if;

  perform public.enqueue_analysis_job(
    v_upload.client_id, 'document_upload', v_upload.id, 'upload'
  );
  return true;
end;
$$;

revoke all on function public.mark_purged_and_enqueue_analysis(uuid) from public, anon, authenticated;
grant execute on function public.mark_purged_and_enqueue_analysis(uuid) to service_role;
