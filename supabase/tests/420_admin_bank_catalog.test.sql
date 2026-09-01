begin;
select plan(58);

select has_table('public', 'bank_catalog_overrides', 'admin catalog overrides are durable');
select has_table('public', 'bank_catalog_status_overrides', 'publication state is durable and separate from lender content');
select has_view('public', 'admin_bank_catalog_read_model', 'admin catalog includes archived rows and source metadata');
select has_function('public', 'admin_create_bank_catalog_entry', array['uuid', 'text', 'jsonb'], 'manual creation RPC exists');
select has_function('public', 'admin_update_bank_catalog_entry', array['uuid', 'text', 'jsonb'], 'override update RPC exists');
select has_function('public', 'admin_set_bank_catalog_status', array['uuid', 'text', 'boolean'], 'archive/reactivate RPC exists');
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid = 'public.bank_catalog_overrides'::regclass
      and conname = 'bank_catalog_overrides_bank_source_unique'
  ),
  1,
  'same bank/source has one override'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid = 'public.bank_catalog_overrides'::regclass
      and conname = 'bank_catalog_overrides_payload_check'
  ),
  1,
  'override payload stays inside the Bank Vault contract'
);

select is(
  has_table_privilege('authenticated', 'public.bank_catalog_overrides', 'insert')
    or has_table_privilege('authenticated', 'public.bank_catalog_overrides', 'update')
    or has_table_privilege('authenticated', 'public.bank_catalog_overrides', 'delete')
    or has_table_privilege('authenticated', 'public.bank_catalog_status_overrides', 'insert')
    or has_table_privilege('authenticated', 'public.bank_catalog_status_overrides', 'update')
    or has_table_privilege('authenticated', 'public.bank_catalog_status_overrides', 'delete'),
  false,
  'a signed-in session cannot write either overlay directly'
);
select is(
  has_table_privilege('service_role', 'public.bank_catalog_overrides', 'insert')
    or has_table_privilege('service_role', 'public.bank_catalog_overrides', 'update')
    or has_table_privilege('service_role', 'public.bank_catalog_overrides', 'delete')
    or has_table_privilege('service_role', 'public.bank_catalog_status_overrides', 'insert')
    or has_table_privilege('service_role', 'public.bank_catalog_status_overrides', 'update')
    or has_table_privilege('service_role', 'public.bank_catalog_status_overrides', 'delete'),
  false,
  'the application service cannot bypass audited RPC writes'
);
select is(
  has_table_privilege('authenticated', 'public.bank_catalog_overrides', 'select')
    or has_table_privilege('authenticated', 'public.bank_catalog_status_overrides', 'select'),
  false,
  'operators cannot directly read overlay actor identifiers'
);
select is_empty(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('bank_read_model', 'admin_bank_catalog_read_model')
      and column_name in ('created_by', 'updated_by')
  $$,
  'catalog views never project actor identifiers'
);
select is(has_function_privilege('authenticated', 'public.admin_create_bank_catalog_entry(uuid,text,jsonb)', 'execute'), false, 'authenticated cannot call create directly');
select is(has_function_privilege('authenticated', 'public.admin_update_bank_catalog_entry(uuid,text,jsonb)', 'execute'), false, 'authenticated cannot call update directly');
select is(has_function_privilege('authenticated', 'public.admin_set_bank_catalog_status(uuid,text,boolean)', 'execute'), false, 'authenticated cannot call lifecycle directly');
select is(has_function_privilege('service_role', 'public.admin_create_bank_catalog_entry(uuid,text,jsonb)', 'execute'), true, 'service role may call audited create');
select is(has_function_privilege('service_role', 'public.admin_update_bank_catalog_entry(uuid,text,jsonb)', 'execute'), true, 'service role may call audited update');
select is(has_function_privilege('service_role', 'public.admin_set_bank_catalog_status(uuid,text,boolean)', 'execute'), true, 'service role may call audited lifecycle');
select is(
  (select updated_at from public.admin_bank_catalog_read_model where bank_ref = 'pnc'),
  (select synced_at from public.banks_cache where bank_ref = 'pnc'),
  'catalog updated_at falls back to the source sync when both optional overlays are absent'
);

create table pg_temp.catalog_payload(value jsonb not null);
insert into pg_temp.catalog_payload values ('{
  "name": "Catalog 420 Bank",
  "products": ["Term loan"],
  "bureau_pulls": "Experian business",
  "qualification_summary": "Current business records",
  "channel_type": "online",
  "channel_value": "https://example.test/apply",
  "checking_required": true,
  "checking_deposit_cents": 100000,
  "checking_seasoning": "90 days",
  "rel_manager": false,
  "rel_manager_tip": "Expect a document follow-up.",
  "application_questions": [
    {"id":"projected-revenue","label":"Projected revenue","responseBasis":"Use the business''s own current revenue projection and supporting records."},
    {"id":"projected-personal-income","label":"Projected personal income","responseBasis":"Use the applicant''s own current income projection and supporting records."},
    {"id":"projected-monthly-spend","label":"Projected monthly spend","responseBasis":"Use the business''s own current operating-budget projection."},
    {"id":"projected-employees","label":"Projected # employees","responseBasis":"Use the business''s own current staffing projection."}
  ],
  "source_updated_at": "2026-08-31"
}'::jsonb);

select is(private.bank_catalog_payload_valid((select value from pg_temp.catalog_payload)), true, 'the exact public catalog payload is accepted');
select is(
  private.bank_catalog_payload_valid(
    pg_catalog.jsonb_set(
      (select value from pg_temp.catalog_payload),
      '{application_questions,0,label}',
      '"Changed standing copy"'::jsonb
    )
  ),
  false,
  'the frozen standing questions cannot be rewritten through a direct service call'
);
select is(
  private.bank_catalog_payload_valid((select value || '{"vault_service_key":"secret"}'::jsonb from pg_temp.catalog_payload)),
  false,
  'an unknown provider credential field is rejected by omission'
);
select is(
  private.bank_catalog_payload_valid(
    pg_catalog.jsonb_set(
      (select value from pg_temp.catalog_payload),
      '{qualification_summary}',
      '"- **3-day rule (HowToCredit `fBqsFVBezyw`):** apply within 3 days."'::jsonb
    )
  ),
  false,
  'raw source markup is rejected at the audited write boundary'
);
select is_empty(
  $$
    select table_name || '.' || column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('bank_catalog_overrides', 'admin_bank_catalog_read_model')
      and column_name ~ '(secret|credential|token|fico|time_in_business|(^|_)tib($|_))'
  $$,
  'neither storage nor readback adds provider secrets or excluded qualification criteria'
);
select lives_ok(
  $$
    insert into public.banks_cache(bank_ref, name, source, application_questions)
    values(
      'manual-source-proof', 'Manual source proof', 'manual',
      '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'
    )
  $$,
  'manual is an explicit cache origin'
);

select is(
  (select bank_ref from public.admin_create_bank_catalog_entry(
    '00000000-0000-0000-0000-000000000001',
    'catalog-420-manual',
    (select value from pg_temp.catalog_payload)
  )),
  'catalog-420-manual',
  'create returns the persisted bank readback'
);
select is(
  (select has_override from public.admin_bank_catalog_read_model where bank_ref = 'catalog-420-manual'),
  true,
  'create readback proves the durable override exists'
);
select is((select source from public.banks_cache where bank_ref = 'catalog-420-manual'), 'manual', 'manual creation also satisfies the application catalog foreign key');
select is((select count(*)::integer from public.bank_catalog_overrides where bank_ref = 'catalog-420-manual'), 1, 'create writes one bank/source overlay');
select is((select count(*)::integer from public.audit_log where action = 'bank_catalog.created' and subject_type = 'bank_catalog_entry'), 1, 'create appends one audit event');

select throws_ok(
  $$select * from public.admin_create_bank_catalog_entry(
    'a1000000-0000-0000-0000-000000000001', 'catalog-420-forbidden',
    (select value from pg_temp.catalog_payload)
  )$$,
  '42501', 'BANK_CATALOG_ACTOR_FORBIDDEN',
  'an operator profile cannot use the service-scoped RPC'
);
select throws_ok(
  $$select * from public.admin_create_bank_catalog_entry(
    '00000000-0000-0000-0000-000000000001', 'catalog-420-manual',
    (select value from pg_temp.catalog_payload)
  )$$,
  '23505', 'BANK_CATALOG_ALREADY_EXISTS',
  'create cannot collide with an existing bank ref'
);

select is(
  (select name from public.admin_update_bank_catalog_entry(
    '00000000-0000-0000-0000-000000000001',
    'bluevine',
    pg_catalog.jsonb_set((select value from pg_temp.catalog_payload), '{name}', '"Bluevine Admin"')
  )),
  'Bluevine Admin',
  'update returns the effective persisted readback'
);
select isnt((select name from public.banks_cache where bank_ref = 'bluevine'), 'Bluevine Admin', 'the provider-owned base row is not rewritten by an admin edit');
select is((select payload ->> 'name' from public.bank_catalog_overrides where bank_ref = 'bluevine'), 'Bluevine Admin', 'the correction lives in the overlay');
select is((select count(*)::integer from public.audit_log where action = 'bank_catalog.updated' and subject_type = 'bank_catalog_entry'), 1, 'update appends one audit event');

update public.banks_cache
set name = 'Bluevine Nightly Source', source = 'vault', synced_at = pg_catalog.clock_timestamp()
where bank_ref = 'bluevine';
select is((select name from public.admin_bank_catalog_read_model where bank_ref = 'bluevine'), 'Bluevine Admin', 'a later nightly source update does not erase content overrides');
select is((select is_active from public.admin_bank_catalog_read_model where bank_ref = 'bluevine'), true, 'a content edit does not disturb the source-owned publication state');

insert into public.clients(id, org_id, display_name)
values('42000000-0000-4000-8000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Catalog reference client');
select lives_ok(
  $$
    insert into public.applications(id, client_id, bank_ref, created_by)
    values(
      '42000000-0000-4000-8000-000000000011',
      '42000000-0000-4000-8000-000000000010',
      'bluevine',
      'a1000000-0000-0000-0000-000000000001'
    )
  $$,
  'applications can reference the effective catalog entry'
);
select is((select outcome_referenced from public.admin_bank_catalog_read_model where bank_ref = 'bluevine'), true, 'admin readback names application or outcome references');

select is(
  (select is_active from public.admin_set_bank_catalog_status(
    '00000000-0000-0000-0000-000000000001', 'bluevine', false
  )),
  false,
  'archive returns the inactive readback'
);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select is((select count(*)::integer from public.bank_read_model where bank_ref = 'bluevine'), 0, 'archive removes the bank from the operator read model');
reset role;
reset request.jwt.claims;
select is((select count(*)::integer from public.applications where bank_ref = 'bluevine'), 1, 'archive leaves application evidence intact');
select throws_ok(
  $$delete from public.banks_cache where bank_ref = 'bluevine'$$,
  '23503', null,
  'the existing foreign key still prevents hard deletion of a referenced bank'
);
select is((select count(*)::integer from public.audit_log where action = 'bank_catalog.archived' and subject_type = 'bank_catalog_entry'), 1, 'archive appends one audit event');

select is(
  (select is_active from public.admin_set_bank_catalog_status(
    '00000000-0000-0000-0000-000000000001', 'bluevine', true
  )),
  true,
  'reactivate returns the active readback'
);
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select is((select count(*)::integer from public.bank_read_model where bank_ref = 'bluevine'), 1, 'reactivation restores the operator read model');
reset role;
reset request.jwt.claims;
select is((select count(*)::integer from public.audit_log where action = 'bank_catalog.reactivated' and subject_type = 'bank_catalog_entry'), 1, 'reactivation appends one audit event');

select is(
  (select is_active from public.admin_set_bank_catalog_status(
    '00000000-0000-0000-0000-000000000001', 'pnc', false
  )),
  false,
  'a source-owned bank can be archived without a content edit'
);
select is(
  (select count(*)::integer from public.bank_catalog_overrides where bank_ref = 'pnc'),
  0,
  'a lifecycle action does not create a content snapshot'
);
select is(
  (select count(*)::integer from public.bank_catalog_status_overrides where bank_ref = 'pnc'),
  1,
  'the lifecycle decision is recorded in the status-only table'
);
update public.banks_cache
set name = 'PNC Nightly Refresh', synced_at = pg_catalog.clock_timestamp()
where bank_ref = 'pnc';
select is(
  (select name from public.admin_set_bank_catalog_status(
    '00000000-0000-0000-0000-000000000001', 'pnc', true
  )),
  'PNC Nightly Refresh',
  'reactivation readback surfaces provider content synced while archived'
);
select is(
  (select has_override from public.admin_bank_catalog_read_model where bank_ref = 'pnc'),
  false,
  'status-only lifecycle never masquerades as a content override'
);

update public.profiles
set disabled_at = pg_catalog.clock_timestamp()
where id = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select * from public.admin_create_bank_catalog_entry(
    '00000000-0000-0000-0000-000000000001', 'catalog-420-disabled',
    (select value from pg_temp.catalog_payload)
  )$$,
  '42501', 'BANK_CATALOG_ACTOR_FORBIDDEN',
  'a disabled platform admin cannot create a catalog entry'
);
select throws_ok(
  $$select * from public.admin_update_bank_catalog_entry(
    '00000000-0000-0000-0000-000000000001', 'bluevine',
    (select value from pg_temp.catalog_payload)
  )$$,
  '42501', 'BANK_CATALOG_ACTOR_FORBIDDEN',
  'a disabled platform admin cannot edit a catalog entry'
);
select throws_ok(
  $$select * from public.admin_set_bank_catalog_status(
    '00000000-0000-0000-0000-000000000001', 'bluevine', false
  )$$,
  '42501', 'BANK_CATALOG_ACTOR_FORBIDDEN',
  'a disabled platform admin cannot change publication state'
);
update public.profiles
set disabled_at = null
where id = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    insert into public.bank_catalog_overrides(
      id, bank_ref, source, payload, created_by, updated_by
    ) values(
      '42000000-0000-4000-8000-000000000099',
      'bluevine', 'platform_admin',
      (select value from pg_temp.catalog_payload),
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001'
    )
  $$,
  '23505', null,
  'the same bank/source cannot acquire a second overlay'
);
select is((select count(*)::integer from public.bank_catalog_overrides where bank_ref = 'bluevine' and source = 'platform_admin'), 1, 'the uniqueness failure leaves one authoritative override');

select * from finish();
rollback;
