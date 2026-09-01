-- R2A-02: paid refresh payment evidence is append-only at table scope too.

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'paid_refresh_payment_events_no_truncate'
      and trigger_row.tgrelid = 'public.paid_refresh_payment_events'::regclass
      and not trigger_row.tgisinternal
  ) then
    create trigger paid_refresh_payment_events_no_truncate
    before truncate on public.paid_refresh_payment_events
    for each statement execute function public.append_only_guard();
  end if;
end
$$;

alter table public.paid_refresh_payment_events
  enable always trigger paid_refresh_payment_events_no_truncate;

revoke truncate on table public.paid_refresh_payment_events
  from public, anon, authenticated, service_role;
