begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R2A-02 carry: derive the contract from every row-immutable
-- UPDATE+DELETE trigger, so a newly added evidence table cannot be omitted.
select plan(4);

create temporary view immutable_row_tables as
select distinct trigger_row.tgrelid
from pg_catalog.pg_trigger as trigger_row
join pg_catalog.pg_proc as trigger_function on trigger_function.oid = trigger_row.tgfoid
where not trigger_row.tgisinternal
  and (trigger_row.tgtype & 8) = 8
  and (trigger_row.tgtype & 16) = 16
  -- 2026-08-17 R2A-09 carry: an audit trigger can fire for both operations
  -- without making the underlying row immutable.
  and trigger_function.proname in (
    'append_only_guard', 'fee_payments_append_only', 'prevent_revenue_ledger_change',
    'prevent_row_change', 'reject_paid_refresh_event_mutation'
  )
  and trigger_row.tgrelid in (
    select relation.oid
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
  );

select cmp_ok(
  (select count(*)::integer from immutable_row_tables),
  '>=', 1,
  'the catalog exposes at least one row-immutable evidence table'
);

select is_empty(
  $$
    select relation.relname
    from immutable_row_tables as immutable
    join pg_catalog.pg_class as relation on relation.oid = immutable.tgrelid
    where not exists (
      select 1
      from pg_catalog.pg_trigger as truncate_trigger
      where truncate_trigger.tgrelid = immutable.tgrelid
        and not truncate_trigger.tgisinternal
        and (truncate_trigger.tgtype & 32) = 32
        and truncate_trigger.tgenabled = 'A'
    )
  $$,
  'every row-immutable evidence table has an always-enabled truncate guard'
);

select is(
  pg_catalog.has_table_privilege(
    'service_role', 'public.paid_refresh_payment_events', 'TRUNCATE'
  ),
  false,
  'service role has no paid refresh payment evidence truncate privilege'
);

set local role service_role;
select throws_ok(
  $$truncate table public.paid_refresh_payment_events$$,
  '42501', null,
  'service role cannot truncate paid refresh payment evidence'
);

select * from finish();
rollback;
