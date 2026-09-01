begin;
set local search_path = public, extensions;

select plan(42);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['console_bank']) as handle
on conflict (bank_ref) do nothing;

select enum_has_labels('public', 'client_status', array['active', 'archived'], 'client status is closed');
select has_column('public', 'clients', 'status', 'clients has status');
select has_column('public', 'clients', 'archived_at', 'clients has archive time');
select has_column('public', 'clients', 'archived_by', 'clients has archive actor');
select has_column('public', 'clients', 'last_activity_at', 'clients has activity time');
select col_not_null('public', 'clients', 'status', 'status is required');
select col_not_null('public', 'clients', 'last_activity_at', 'activity is required');
select has_index('public', 'clients', 'clients_org_status_stage_idx', 'active list index exists');
select has_function('public', 'tracker_client_health', array['client_stage','timestamptz','timestamptz','timestamptz'], 'health classifier exists');
select has_function('public', 'tracker_client_health_batch', array['uuid[]','timestamptz'], 'batch health exists');
select has_function('public', 'set_client_status', array['uuid','client_status','uuid'], 'status RPC exists');
select ok(has_function_privilege('authenticated', 'public.set_client_status(uuid,public.client_status,uuid)', 'execute'), 'authenticated reaches status authorization');
select ok(has_function_privilege('service_role', 'public.set_client_status(uuid,public.client_status,uuid)', 'execute'), 'service role reaches status authorization');
select ok(not has_function_privilege('anon', 'public.set_client_status(uuid,public.client_status,uuid)', 'execute'), 'anonymous cannot execute status RPC');

-- 380 (DEC-OWN-INTAKE-R2): the client's ruling is "no activity for 30 days";
-- the boundary pair asserts the ruling's value, not 190's original default.
select is(public.tracker_client_health('onboarding', now() - interval '100 days', now() - interval '29 days 23 hours', now()), 'green', 'quiet before 30 days is green');
select is(public.tracker_client_health('onboarding', now() - interval '100 days', now() - interval '30 days', now()), 'red', 'quiet at 30 days is red');
select is(public.tracker_client_health('optimization', now() - interval '44 days 23 hours', now(), now()), 'green', 'target before day 45 is green');
select is(public.tracker_client_health('optimization', now() - interval '45 days', now(), now()), 'amber', 'target at day 45 is amber');
select is(public.tracker_client_health('optimization', now() - interval '60 days', now(), now()), 'amber', 'target at day 60 is amber');
select is(public.tracker_client_health('optimization', now() - interval '60 days 1 second', now(), now()), 'red', 'target after day 60 is red');
select is(public.tracker_client_health('applying', now() - interval '45 days', now(), now()), 'amber', 'applying uses the target');
select is(public.tracker_client_health('ready', now() - interval '100 days', now(), now()), 'green', 'ready has no target');
select is(public.tracker_client_health('funded', now() - interval '100 days', now(), now()), 'green', 'funded has no target');
select is(public.tracker_client_health('graduate', now() - interval '100 days', now(), now()), 'green', 'graduate has no target');

insert into auth.users(id,email) values
 ('19000000-0000-4000-8000-000000000011','owner-a@console.test'),
 ('19000000-0000-4000-8000-000000000012','consumer-a@console.test'),
 ('19000000-0000-4000-8000-000000000021','owner-b@console.test');
insert into public.orgs(id,name,slug) values
 ('19000000-0000-4000-8000-000000000001','Console A','console-a'),
 ('19000000-0000-4000-8000-000000000002','Console B','console-b');
insert into public.profiles(id,role,org_id,org_role,full_name,email) values
 ('19000000-0000-4000-8000-000000000011','operator_member','19000000-0000-4000-8000-000000000001','owner','Owner A','owner-a@console.test'),
 ('19000000-0000-4000-8000-000000000012','consumer','19000000-0000-4000-8000-000000000001',null,'Consumer A','consumer-a@console.test'),
 ('19000000-0000-4000-8000-000000000021','operator_member','19000000-0000-4000-8000-000000000002','owner','Owner B','owner-b@console.test')
on conflict (id) do update set role=excluded.role,org_id=excluded.org_id,org_role=excluded.org_role,full_name=excluded.full_name,email=excluded.email;
-- 2026-08-17 R3A-05: health ranking depends on the historical lifecycle
-- timestamps below, so mark only this setup insert as governed.
select pg_catalog.set_config('app.governed_client_write', 'on', true);
insert into public.clients(id,org_id,consumer_profile_id,assigned_to,display_name,stage,stage_entered_at,last_activity_at) values
 ('19000000-0000-4000-8000-000000000101','19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000012','19000000-0000-4000-8000-000000000011','Console Client','optimization',now()-interval '50 days',now()-interval '20 days');
select pg_catalog.set_config('app.governed_client_write', '', true);

select is((select status from public.clients where id='19000000-0000-4000-8000-000000000101'), 'active'::public.client_status, 'new clients default active');

insert into public.stage_history(client_id,from_stage,to_stage,changed_at,changed_by) values
 ('19000000-0000-4000-8000-000000000101','onboarding','optimization',now()-interval '10 days','19000000-0000-4000-8000-000000000011');
select is((select last_activity_at::date from public.clients where id='19000000-0000-4000-8000-000000000101'), (now()-interval '10 days')::date, 'stage history advances activity');

insert into public.support_threads(id,kind,org_id,client_id,subject,created_by) values
 ('19000000-0000-4000-8000-000000000201','team_chat','19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000101','Console support','19000000-0000-4000-8000-000000000011');
insert into public.support_messages(thread_id,author_profile_id,author_kind,body,sent_at) values
 ('19000000-0000-4000-8000-000000000201','19000000-0000-4000-8000-000000000011','operator','Support note',now()-interval '9 days');
select is((select last_activity_at::date from public.clients where id='19000000-0000-4000-8000-000000000101'), (now()-interval '9 days')::date, 'support message advances activity');

insert into public.applications(id,client_id,bank_ref,created_by) values
 ('19000000-0000-4000-8000-000000000301','19000000-0000-4000-8000-000000000101','console_bank','19000000-0000-4000-8000-000000000011');
insert into public.outcomes(id,application_id,bank_ref,client_id,kind,recorded_by,recorded_by_kind,created_at) values
 ('19000000-0000-4000-8000-000000000302','19000000-0000-4000-8000-000000000301','console_bank','19000000-0000-4000-8000-000000000101','denied','19000000-0000-4000-8000-000000000011','operator',now()-interval '8 days');
select is((select last_activity_at::date from public.clients where id='19000000-0000-4000-8000-000000000101'), (now()-interval '8 days')::date, 'outcome advances activity');

insert into public.document_uploads(id,org_id,client_id,kind,section,bucket,object_path,display_name,mime_type,size_bytes,lifecycle,uploaded_by,created_at,updated_at) values
 ('19000000-0000-4000-8000-000000000401','19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000101','company','articles','client-documents','19000000-0000-4000-8000-000000000001/19000000-0000-4000-8000-000000000101/19000000-0000-4000-8000-000000000401/file.pdf','file.pdf','application/pdf',12,'stored','19000000-0000-4000-8000-000000000011',now()-interval '7 days',now()-interval '7 days');
select is((select last_activity_at::date from public.clients where id='19000000-0000-4000-8000-000000000101'), (now()-interval '7 days')::date, 'document upload advances activity');

insert into public.checklist_templates(id,kind,key,title,blocking,sort_order) values
 ('19000000-0000-4000-8000-000000000501','personal_credit','console_item','Console item',true,999);
insert into public.checklist_items(id,client_id,template_id,title,blocking,sort_order) values
 ('19000000-0000-4000-8000-000000000502','19000000-0000-4000-8000-000000000101','19000000-0000-4000-8000-000000000501','Console item',true,999);
insert into public.checklist_item_state(checklist_item_id,client_id) values
 ('19000000-0000-4000-8000-000000000502','19000000-0000-4000-8000-000000000101');
select ok((select last_activity_at > now()-interval '1 minute' from public.clients where id='19000000-0000-4000-8000-000000000101'), 'todo insert uses statement time');

insert into public.stage_history(client_id,from_stage,to_stage,changed_at,changed_by) values
 ('19000000-0000-4000-8000-000000000101','optimization','ready',now()-interval '30 days','19000000-0000-4000-8000-000000000011');
select ok((select last_activity_at > now()-interval '1 minute' from public.clients where id='19000000-0000-4000-8000-000000000101'), 'older event cannot regress activity');

select results_eq(
 $$select health,health_rank from public.tracker_client_health_batch(array['19000000-0000-4000-8000-000000000101'::uuid],now())$$,
 $$values ('amber'::text,1)$$,
 'batch returns the exact health and rank'
);

set local request.jwt.claims = '{"sub":"19000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select * from public.set_client_status('19000000-0000-4000-8000-000000000101','archived','19000000-0000-4000-8000-000000000011')$$, 'owning operator archives');
reset role;
select ok((select status='archived' and archived_at is not null and archived_by='19000000-0000-4000-8000-000000000011' from public.clients where id='19000000-0000-4000-8000-000000000101'), 'archive evidence is atomic');
select is((select count(*)::integer from public.audit_log where subject_id='19000000-0000-4000-8000-000000000101' and action='client.status.changed'),1,'archive writes one audit');

set local role authenticated;
select lives_ok($$select * from public.set_client_status('19000000-0000-4000-8000-000000000101','archived','19000000-0000-4000-8000-000000000011')$$, 'idempotent archive returns');
reset role;
select is((select count(*)::integer from public.audit_log where subject_id='19000000-0000-4000-8000-000000000101' and action='client.status.changed'),1,'idempotent archive adds no audit');

set local request.jwt.claims = '{"sub":"19000000-0000-4000-8000-000000000021","role":"authenticated"}';
set local role authenticated;
select throws_ok($$select * from public.set_client_status('19000000-0000-4000-8000-000000000101','active','19000000-0000-4000-8000-000000000021')$$,'42501','CLIENT_STATUS_FORBIDDEN','foreign operator cannot unarchive');
reset role;

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select lives_ok($$select * from public.set_client_status('19000000-0000-4000-8000-000000000101','active','19000000-0000-4000-8000-000000000011')$$,'service demo adapter unarchives with the same actor reach');
reset role;
select ok((select status='active' and archived_at is null and archived_by is null from public.clients where id='19000000-0000-4000-8000-000000000101'),'unarchive clears evidence');
select is((select count(*)::integer from public.audit_log where subject_id='19000000-0000-4000-8000-000000000101' and action='client.status.changed'),2,'two real flips produce two audits');
select is((select count(*)::integer from public.support_threads where client_id='19000000-0000-4000-8000-000000000101'),1,'status flips preserve dependent rows');

select * from finish();
rollback;
