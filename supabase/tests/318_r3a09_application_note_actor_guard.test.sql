begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['r3a09']) as handle
on conflict (bank_ref) do nothing;

insert into public.applications(id, client_id, bank_ref, created_by)
values('31800000-0000-4000-8000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'r3a09', 'a1000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
select throws_ok(
  $$insert into public.application_notes(
      id, application_id, author_profile_id, author_kind, body, attested
    ) values (
      '31800000-0000-4000-8000-000000000101',
      '31800000-0000-4000-8000-000000000001',
      'a1000000-0000-0000-0000-000000000011',
      'operator', 'consumer supplied operator attestation', true
    )$$,
  '42501', null,
  'a consumer cannot publish an operator-attributed note'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
select throws_ok(
  $$insert into public.application_notes(
      id, application_id, author_profile_id, author_kind, body, attested
    ) values (
      '31800000-0000-4000-8000-000000000102',
      '31800000-0000-4000-8000-000000000001',
      'a1000000-0000-0000-0000-000000000001',
      'consumer', 'operator supplied consumer attribution', false
    )$$,
  '42501', null,
  'an operator cannot publish a consumer-attributed note'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000011"}';
insert into public.application_notes(id, application_id, author_profile_id, author_kind, body, attested)
values('31800000-0000-4000-8000-000000000103', '31800000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000011', 'consumer', 'consumer note', false);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a1000000-0000-0000-0000-000000000001"}';
insert into public.application_notes(id, application_id, author_profile_id, author_kind, body, attested)
values('31800000-0000-4000-8000-000000000104', '31800000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'operator', 'operator note', true);
reset role;
select results_eq(
  $$select author_kind::text, attested from public.application_notes
    where id in ('31800000-0000-4000-8000-000000000103', '31800000-0000-4000-8000-000000000104')
    order by id$$,
  $$values ('consumer'::text, false), ('operator'::text, true)$$,
  'consumer and operator note shapes retain their attestation behavior'
);

set local role service_role;
select lives_ok(
  $$insert into public.application_notes(id, application_id, author_profile_id, author_kind, body, attested) values
      ('31800000-0000-4000-8000-000000000105', '31800000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000011', 'consumer', 'admin consumer note', false),
      ('31800000-0000-4000-8000-000000000106', '31800000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'operator', 'admin operator note', true)$$,
  'the no-JWT admin client path can insert both stored actor shapes'
);
reset role;

select * from finish();
rollback;
