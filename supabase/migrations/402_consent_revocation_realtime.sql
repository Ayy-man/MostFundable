-- A consent withdrawal must refresh the operator tracker immediately. Realtime
-- still enforces the table's existing forced-RLS select policies per subscriber;
-- publication membership grants no new read or write privilege.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication is required';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'consent_revocations'
  ) then
    alter publication supabase_realtime add table public.consent_revocations;
  end if;
end;
$$;
