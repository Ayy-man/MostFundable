begin;

set local search_path = public, extensions;

select plan(4);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'consent_revocations'
  ),
  1,
  'consent withdrawals are published so the operator tracker can refresh immediately'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.consent_revocations'::regclass),
  'published consent withdrawals keep forced row level security'
);

select ok(
  has_table_privilege('authenticated', 'public.consent_revocations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.consent_revocations', 'INSERT,UPDATE,DELETE'),
  'realtime adds no browser write authority to consent withdrawals'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'consent_revocations'
      and policyname = 'consent_revocations_select_operator'
      and cmd = 'SELECT'
  ),
  1,
  'operator delivery remains filtered by the existing tenant policy'
);

select * from finish();

rollback;
