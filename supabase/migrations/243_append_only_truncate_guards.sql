-- R1A-04: append-only audit, history, billing, application, and revenue evidence
-- must reject table-wide erasure as well as row-level update and delete.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'application_notes',
    'audit_log',
    'billing_refund_observations',
    'fee_payments',
    'operator_billing_events',
    'operator_earnings_ledger',
    'referral_ledger',
    'stage_history'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger_row
      where trigger_row.tgname = v_table || '_no_truncate'
        and trigger_row.tgrelid = ('public.' || v_table)::regclass
        and not trigger_row.tgisinternal
    ) then
      execute format(
        'create trigger %I before truncate on public.%I '
        'for each statement execute function public.append_only_guard()',
        v_table || '_no_truncate',
        v_table
      );
    end if;

    execute format(
      'alter table public.%I enable always trigger %I',
      v_table,
      v_table || '_no_truncate'
    );
    execute format(
      'revoke truncate on table public.%I from public, anon, authenticated, service_role',
      v_table
    );
  end loop;
end
$$;
