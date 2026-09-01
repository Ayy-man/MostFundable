begin;
set local search_path = public, extensions;
select plan(15);

insert into public.orgs (id, name, slug)
values ('40000000-0000-4000-8000-000000000001', 'CRS Pointer Org', 'crs-pointer-org');
insert into public.clients (id, org_id, display_name)
values ('40000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000001', 'CRS Pointer Client');
insert into public.monitoring_events (id, client_id, event_type, occurred_at, received_at)
values (
  '40000000-0000-4000-8000-000000000201',
  '40000000-0000-4000-8000-000000000101',
  'ACCALERT',
  '2026-08-31T01:00:00Z',
  '2026-08-31T01:00:01Z'
);

select has_table('public', 'crs_alert_pointers', 'the pointer-only alert table exists');
select columns_are(
  'public',
  'crs_alert_pointers',
  array[
    'id', 'client_id', 'monitoring_event_id', 'provider_hook_key', 'provider_alert_key',
    'alert_id_ciphertext', 'alert_id_iv', 'alert_id_tag', 'key_version', 'occurred_at',
    'alert_reported_at', 'received_at', 'expires_at', 'delivered_at', 'read_at', 'expired_at'
  ],
  'the catalog exposes only the approved pointer and operational columns'
);
select is(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.crs_alert_pointers'::regclass),
  true,
  'RLS is enabled and forced'
);
select has_function('public', 'scrub_expired_crs_alert_pointers', array['timestamp with time zone', 'integer'], 'the bounded retention scrub exists');

set local role authenticated;
select throws_ok($$ select * from public.crs_alert_pointers $$, '42501', 'permission denied for table crs_alert_pointers', 'authenticated callers cannot read encrypted provider pointers directly');
select throws_ok($$ insert into public.crs_alert_pointers(client_id,monitoring_event_id,provider_hook_key,provider_alert_key,alert_id_ciphertext,alert_id_iv,alert_id_tag,key_version,occurred_at,alert_reported_at,received_at,expires_at) values ('40000000-0000-4000-8000-000000000101','40000000-0000-4000-8000-000000000201',repeat('a',64),repeat('b',64),'cipher','iv','tag',1,'2026-08-31T01:00:00Z','2026-08-31T00:59:00Z','2026-08-31T01:00:01Z','2026-11-29T01:00:01Z') $$, '42501', 'permission denied for table crs_alert_pointers', 'authenticated callers cannot write pointers');

reset role;
set local role service_role;
insert into public.crs_alert_pointers(client_id,monitoring_event_id,provider_hook_key,provider_alert_key,alert_id_ciphertext,alert_id_iv,alert_id_tag,key_version,occurred_at,alert_reported_at,received_at,expires_at)
values ('40000000-0000-4000-8000-000000000101','40000000-0000-4000-8000-000000000201',repeat('a',64),repeat('b',64),'cipher','iv','tag',1,'2026-08-31T01:00:00Z','2026-08-31T00:59:00Z','2026-08-31T01:00:01Z','2026-11-29T01:00:01Z');
select is((select count(*)::integer from public.crs_alert_pointers), 1, 'service role can insert one protected pointer');
reset role;
select throws_ok($$ update public.crs_alert_pointers set expires_at = received_at + interval '89 days' $$, '23514', null, 'the catalog enforces the approved 90-day window');
select is(public.scrub_expired_crs_alert_pointers('2026-11-29T01:00:00Z', 500), 0, 'the pointer remains readable one second before expiry');
select is(public.scrub_expired_crs_alert_pointers('2026-11-29T01:00:01Z', 500), 1, 'the pointer is scrubbed at expiry');
select is((select alert_id_ciphertext from public.crs_alert_pointers limit 1), null, 'expiry removes encrypted alert id bytes');
select isnt((select provider_hook_key from public.crs_alert_pointers limit 1), null, 'expiry retains only the content-free hook dedupe key');
select isnt((select expired_at from public.crs_alert_pointers limit 1), null, 'expiry is durable state');
select is(public.scrub_expired_crs_alert_pointers('2026-11-30T01:00:01Z', 500), 0, 'the scrub is replay safe');

delete from public.monitoring_events where id = '40000000-0000-4000-8000-000000000201';
select is((select count(*)::integer from public.crs_alert_pointers), 0, 'cancellation purge cascades through the monitoring event');

select * from finish();
rollback;
