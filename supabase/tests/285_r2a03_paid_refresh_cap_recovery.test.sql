begin;
set local search_path = public, extensions;

-- 2026-08-17 R2A-03: paid and queued work recovers its own capacity.
select plan(10);

insert into auth.users(id, email) values
  ('28500000-0000-4000-8000-000000000001', 'admin@r2a03.test');
insert into public.orgs(id, name, slug) values
  ('28500000-0000-4000-8000-000000000101', 'Paid Capacity Recovery', 'r2a03-capacity');
insert into public.profiles(id, role, full_name, email) values
  ('28500000-0000-4000-8000-000000000001', 'platform_admin', 'R2A03 Admin', 'admin@r2a03.test')
on conflict(id) do update set role = excluded.role;
insert into public.clients(id, org_id, display_name) values
  ('28500000-0000-4000-8000-000000000201', '28500000-0000-4000-8000-000000000101', 'Paid Capacity Client');

insert into public.paid_refresh_requests(
  id, actor_profile_id, client_id, org_id, idempotency_key,
  amount_cents, currency, driver
) values
  ('28500000-0000-4000-8000-000000000301','28500000-0000-4000-8000-000000000001','28500000-0000-4000-8000-000000000201','28500000-0000-4000-8000-000000000101','r2a03-paid',1900,'usd','mock'),
  ('28500000-0000-4000-8000-000000000302','28500000-0000-4000-8000-000000000001','28500000-0000-4000-8000-000000000201','28500000-0000-4000-8000-000000000101','r2a03-other',1900,'usd','mock');

select public.set_pull_cap(
  '28500000-0000-4000-8000-000000000201', null, 1, 3600,
  '28500000-0000-4000-8000-000000000001'
);
select is(
  (select allowed from public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000201',
    '28500000-0000-4000-8000-000000000301', 60
  )),
  true,
  'the original request reserves capacity before payment'
);
select public.record_paid_refresh_payment_event(
  '28500000-0000-4000-8000-000000000301',
  'evt_285_paid', 'pay_285_paid', 'succeeded', 1900, 'usd'
);
update public.pull_cap_attempts
set reservation_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where source_id = '28500000-0000-4000-8000-000000000301';

select is(
  (select allowed from public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000201',
    '28500000-0000-4000-8000-000000000302', 60
  )),
  true,
  'another request may reserve after the original lease expires'
);
select is(
  (select allowed from public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000201',
    '28500000-0000-4000-8000-000000000301', 60
  )),
  true,
  'succeeded payment evidence prevents a capacity denial on retry'
);
select is(
  (select reservation_state from public.pull_cap_attempts
    where source_id = '28500000-0000-4000-8000-000000000301'),
  'committed',
  'paid recovery commits the original capacity row'
);
select is(
  (select reason::text from public.pull_cap_attempts
    where source_id = '28500000-0000-4000-8000-000000000301'),
  null::text,
  'paid recovery clears the earlier capacity decision reason'
);

delete from public.pull_cap_attempts
where client_id = '28500000-0000-4000-8000-000000000201';

insert into public.analysis_jobs(
  id, client_id, source_kind, source_id, analysis_run_id, trigger
) values (
  '28500000-0000-4000-8000-000000000401',
  '28500000-0000-4000-8000-000000000201',
  'force_pull', '28500000-0000-4000-8000-000000000303',
  '28500000-0000-4000-8000-000000000501', 'force_pull'
);
insert into public.paid_refresh_requests(
  id, actor_profile_id, client_id, org_id, idempotency_key,
  amount_cents, currency, driver, state, provider_payment_ref, analysis_run_id
) values
  (
    '28500000-0000-4000-8000-000000000303','28500000-0000-4000-8000-000000000001',
    '28500000-0000-4000-8000-000000000201','28500000-0000-4000-8000-000000000101',
    'r2a03-queued',1900,'usd','mock','queued','pay_285_queued','28500000-0000-4000-8000-000000000501'
  ),
  (
    '28500000-0000-4000-8000-000000000304','28500000-0000-4000-8000-000000000001',
    '28500000-0000-4000-8000-000000000201','28500000-0000-4000-8000-000000000101',
    'r2a03-competing',1900,'usd','mock','initiated',null,null
  );

select is(
  (select allowed from public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000201',
    '28500000-0000-4000-8000-000000000304', 60
  )),
  true,
  'a competing request occupies the configured slot'
);
select is(
  (select allowed from public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000201',
    '28500000-0000-4000-8000-000000000303', 60
  )),
  true,
  'queued work also recovers and commits its capacity'
);
select is(
  (select reservation_state from public.pull_cap_attempts
    where source_id = '28500000-0000-4000-8000-000000000303'),
  'committed',
  'queued recovery leaves a committed capacity row'
);
select throws_ok(
  $$select public.reserve_paid_refresh_pull(
    '28500000-0000-4000-8000-000000000299',
    '28500000-0000-4000-8000-000000000303', 60
  )$$,
  'P0002',
  'PAID_REFRESH_NOT_FOUND',
  'the request lock also binds recovery to its client'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.reserve_paid_refresh_pull(uuid,uuid,integer)'::regprocedure
  ) like '%from public.paid_refresh_requests as request%for update%',
  'capacity recovery locks the durable request row'
);

select * from finish();
rollback;
