-- 392_demo_reset_consumer_workspace.test.sql
--
-- The demo reset is a rebinding, never an erasure. Subjects are derived from the seed rather than
-- transcribed: the enrolled persona is whichever seeded consumer holds an enrollment, and the
-- allowed-address list is read back from `profiles`, so a seed that renames a persona fails here
-- rather than on the deployment.

begin;

set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Grants: application roles cannot reach it; only service_role may.
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('anon', 'public.demo_reset_consumer_workspace(uuid, text[])', 'execute'),
  false,
  'anon cannot execute the demo reset'
);
select is(
  has_function_privilege('authenticated', 'public.demo_reset_consumer_workspace(uuid, text[])', 'execute'),
  false,
  'authenticated cannot execute the demo reset'
);
select is(
  has_function_privilege('service_role', 'public.demo_reset_consumer_workspace(uuid, text[])', 'execute'),
  true,
  'service_role can execute the demo reset'
);

-- ---------------------------------------------------------------------------
-- Subject: a seeded consumer that holds an active enrollment.
-- ---------------------------------------------------------------------------

create temporary table t392_subject as
select
  profile.id as profile_id,
  lower(profile.email) as email,
  client.id as old_client_id,
  client.org_id,
  client.business_name,
  client.display_name,
  enrollment.id as enrollment_id,
  (select count(*) from public.consents as consent where consent.client_id = client.id) as consent_count
from public.profiles as profile
join public.clients as client on client.consumer_profile_id = profile.id
join public.enrollments as enrollment on enrollment.client_id = client.id
where profile.role = 'consumer'
order by profile.email
limit 1;

select isnt_empty(
  $$ select 1 from t392_subject $$,
  'the seed carries an enrolled consumer to reset'
);

-- ---------------------------------------------------------------------------
-- Refusals.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.demo_reset_consumer_workspace(
       (select profile_id from t392_subject),
       array['nobody@example.test']
     ) $$,
  '42501',
  'DEMO_RESET_FORBIDDEN',
  'a consumer outside the allowed list is refused'
);

select throws_ok(
  $$ select public.demo_reset_consumer_workspace(
       (select id from public.profiles where role = 'operator_member' order by email limit 1),
       array[(select lower(email) from public.profiles where role = 'operator_member' order by email limit 1)]
     ) $$,
  '42501',
  'DEMO_RESET_FORBIDDEN',
  'a non-consumer profile is refused even when listed'
);

-- ---------------------------------------------------------------------------
-- The reset.
-- ---------------------------------------------------------------------------

create temporary table t392_result as
select public.demo_reset_consumer_workspace(
  (select profile_id from t392_subject),
  array[(select email from t392_subject)]
) as new_client_id;

select isnt(
  (select new_client_id from t392_result),
  (select old_client_id from t392_subject),
  'the reset returns a client that is not the archived one'
);

select is(
  (select status::text || '|' || coalesce(consumer_profile_id::text, 'null') || '|' || coalesce(archived_by::text, 'null')
     from public.clients where id = (select old_client_id from t392_subject)),
  'archived|null|' || (select profile_id::text from t392_subject),
  'the old client is archived, released from the profile, and stamped with the actor'
);

select is(
  (select stage::text || '|' || status::text || '|' || consumer_profile_id::text || '|' || org_id::text
          || '|' || coalesce(business_name, '') || '|' || display_name
     from public.clients where id = (select new_client_id from t392_result)),
  'onboarding|active|' || (select profile_id::text from t392_subject) || '|' || (select org_id::text from t392_subject)
    || '|' || (select coalesce(business_name, '') from t392_subject) || '|' || (select display_name from t392_subject),
  'the new client is an active Onboarding row for the same profile, org, business and name'
);

select is(
  (select client_id from public.enrollments where id = (select enrollment_id from t392_subject)),
  (select old_client_id from t392_subject),
  'the enrollment stays attached to the archived client'
);

select is(
  (select count(*) from public.enrollments where client_id = (select new_client_id from t392_result)),
  0::bigint,
  'the new client holds no enrollment'
);

select is(
  (select count(*) from public.consents where client_id = (select old_client_id from t392_subject)),
  (select consent_count from t392_subject),
  'no consent row was erased'
);

select is(
  (select count(*) from public.audit_log
     where action = 'client.demo_reset'
       and subject_id = (select old_client_id from t392_subject)
       and meta ->> 'to' = (select new_client_id::text from t392_result)),
  1::bigint,
  'the reset is audited from the old client to the new one'
);

-- A second reset must work on the fresh row, so a tester can walk the beat any number of times.
select lives_ok(
  $$ select public.demo_reset_consumer_workspace(
       (select profile_id from t392_subject),
       array[(select email from t392_subject)]
     ) $$,
  'the reset can be run again on the new client'
);

select * from finish();

rollback;
