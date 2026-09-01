begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(54);

insert into public.orgs (id, name, slug, team_sees_all_clients) values
  ('43000000-0000-4000-8000-000000000001', 'Client Notes Org', 'client-notes-org', false),
  ('43000000-0000-4000-8000-000000000002', 'Other Client Notes Org', 'other-client-notes-org', false);

insert into auth.users (id, email) values
  ('43000000-0000-4000-8000-000000000011', 'owner@client-notes.test'),
  ('43000000-0000-4000-8000-000000000012', 'consumer@client-notes.test'),
  ('43000000-0000-4000-8000-000000000013', 'outsider@client-notes.test'),
  ('43000000-0000-4000-8000-000000000014', 'unassigned@client-notes.test'),
  ('43000000-0000-4000-8000-000000000015', 'assigned@client-notes.test'),
  ('43000000-0000-4000-8000-000000000016', 'admin@client-notes.test'),
  ('43000000-0000-4000-8000-000000000017', 'privacy@client-notes.test');

insert into public.profiles (id, role, org_id, org_role, full_name, email) values
  ('43000000-0000-4000-8000-000000000011', 'operator_member', '43000000-0000-4000-8000-000000000001', 'owner', 'Notes Owner', 'owner@client-notes.test'),
  ('43000000-0000-4000-8000-000000000012', 'consumer', '43000000-0000-4000-8000-000000000001', null, 'Notes Consumer', 'consumer@client-notes.test'),
  ('43000000-0000-4000-8000-000000000013', 'operator_member', '43000000-0000-4000-8000-000000000002', 'owner', 'Notes Outsider', 'outsider@client-notes.test'),
  ('43000000-0000-4000-8000-000000000014', 'operator_member', '43000000-0000-4000-8000-000000000001', 'member', 'Unassigned Member', 'unassigned@client-notes.test'),
  ('43000000-0000-4000-8000-000000000015', 'operator_member', '43000000-0000-4000-8000-000000000001', 'member', 'Assigned Member', 'assigned@client-notes.test'),
  ('43000000-0000-4000-8000-000000000016', 'platform_admin', null, null, 'Privacy Admin', 'admin@client-notes.test'),
  ('43000000-0000-4000-8000-000000000017', 'consumer', '43000000-0000-4000-8000-000000000001', null, 'Privacy Consumer', 'privacy@client-notes.test')
on conflict (id) do update set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to) values
  ('43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000012', 'Notes Client', '43000000-0000-4000-8000-000000000015'),
  ('43000000-0000-4000-8000-000000000022', '43000000-0000-4000-8000-000000000002', null, 'Other Notes Client', '43000000-0000-4000-8000-000000000013'),
  ('43000000-0000-4000-8000-000000000023', '43000000-0000-4000-8000-000000000001', null, 'Capped Notes Client', '43000000-0000-4000-8000-000000000015'),
  ('43000000-0000-4000-8000-000000000024', '43000000-0000-4000-8000-000000000001', null, 'Archived Notes Client', '43000000-0000-4000-8000-000000000015'),
  ('43000000-0000-4000-8000-000000000025', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000017', 'Privacy Notes Client', '43000000-0000-4000-8000-000000000015');

select has_table('public', 'client_notes', 'operator client notes are durable');
select is(
  (select pg_catalog.count(*)::integer from pg_catalog.pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_client_org_fk'),
  1,
  'client and organization are one composite anchor'
);
select is(
  (select pg_catalog.count(*)::integer from pg_catalog.pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_org_request_key'),
  1,
  'create request identities are durable and unique per organization'
);
select is(
  (select pg_catalog.count(*)::integer from pg_catalog.pg_constraint where conrelid = 'public.client_notes'::regclass and conname = 'client_notes_body_and_deletion_shape'),
  1,
  'live note bodies are bounded and deleted bodies are erased'
);
select has_trigger('public', 'client_notes', 'client_notes_validate', 'the write guard is structural');
select has_trigger('public', 'privacy_requests', 'privacy_requests_erase_client_notes', 'privacy completion owns note erasure');
select ok(
  has_table_privilege('authenticated', 'public.client_notes', 'select')
    and not has_table_privilege('authenticated', 'public.client_notes', 'insert')
    and not has_table_privilege('authenticated', 'public.client_notes', 'update')
    and not has_table_privilege('authenticated', 'public.client_notes', 'delete'),
  'authenticated sessions get operator-filtered reads and no direct mutation'
);
select ok(
  not has_table_privilege('service_role', 'public.client_notes', 'insert')
    and not has_table_privilege('service_role', 'public.client_notes', 'update')
    and not has_table_privilege('service_role', 'public.client_notes', 'delete'),
  'the application service cannot bypass the audited mutation functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.client_note_create(uuid,uuid,uuid,uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.client_note_update(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.client_note_delete(uuid,uuid,uuid,uuid,timestamptz)', 'execute'),
  'a browser session cannot forge the actor parameter on a mutation RPC'
);
select ok(
  has_function_privilege('service_role', 'public.client_notes_list(uuid,uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.client_note_create(uuid,uuid,uuid,uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.client_note_update(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.client_note_delete(uuid,uuid,uuid,uuid,timestamptz)', 'execute'),
  'the trusted server can use the closed read and mutation rails'
);
select ok(
  not has_function_privilege('service_role', 'private.client_notes_lock_scope(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('service_role', 'private.client_notes_actor_can_access_client(uuid,uuid,uuid)', 'execute'),
  'internal lock and reach helpers are not application APIs'
);

create temporary table note_identity on commit drop as
select (public.client_note_create(
  '43000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000021',
  '43000000-0000-4000-8000-000000000011',
  '43000000-0000-4000-8000-000000000041',
  '  Confirm the operating address before applying.  '
) ->> 'id')::uuid as id;

select is((select body from public.client_notes where id = (select id from note_identity)), 'Confirm the operating address before applying.', 'creation normalizes and durably stores the bounded note body');
select ok(
  (public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000041', 'Confirm the operating address before applying.') ->> 'created_by_name') = 'Notes Owner'
  and not public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000041', 'Confirm the operating address before applying.') ?| array['org_id', 'request_id'],
  'the atomic create projection has attribution and no tenant or request metadata'
);
select is((select count(*) from public.audit_log where action = 'client.note_created' and subject_id = (select id from note_identity)), 1::bigint, 'creation appends exactly one fixed-action audit event');
select is(
  (public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000041', 'Confirm the operating address before applying.') ->> 'id')::uuid,
  (select id from note_identity),
  'an exact create replay returns the original durable note'
);
select is((select count(*) from public.client_notes where client_id = '43000000-0000-4000-8000-000000000021'), 1::bigint, 'an exact create replay cannot duplicate the note');
select is((select count(*) from public.audit_log where action = 'client.note_created' and subject_id = (select id from note_identity)), 1::bigint, 'an exact create replay cannot duplicate the audit event');
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000041', 'Conflicting replay')$$,
  '23505', 'CLIENT_NOTE_REQUEST_CONFLICT', 'one request identity cannot be reused with different content'
);
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000022', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000042', 'Cross tenant')$$,
  'P0002', 'CLIENT_NOTES_NOT_FOUND', 'a client from another organization is indistinguishable from a missing client'
);
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000014', '43000000-0000-4000-8000-000000000043', 'Unassigned member attempt')$$,
  'P0002', 'CLIENT_NOTES_NOT_FOUND', 'same-organization membership cannot bypass per-client reach'
);
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000012', '43000000-0000-4000-8000-000000000044', 'Consumer attempt')$$,
  '42501', 'CLIENT_NOTES_FORBIDDEN', 'a consumer identity cannot create an operator note through the service rail'
);
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000045', repeat('x', 4001))$$,
  '22023', 'CLIENT_NOTE_BODY_INVALID', 'the database refuses an oversized body even if HTTP validation is bypassed'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"43000000-0000-4000-8000-000000000011"}';
select is((select count(*) from public.client_notes), 1::bigint, 'an owner reads a reachable live note through RLS');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"43000000-0000-4000-8000-000000000015"}';
select is((select count(*) from public.client_notes), 1::bigint, 'the assigned operator reads the client note through RLS');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"43000000-0000-4000-8000-000000000014"}';
select is((select count(*) from public.client_notes), 0::bigint, 'an unassigned same-organization member cannot read the note');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"43000000-0000-4000-8000-000000000012"}';
select is((select count(*) from public.client_notes), 0::bigint, 'the client attached to the record cannot read its operator note');
reset role;
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"43000000-0000-4000-8000-000000000013"}';
select is((select count(*) from public.client_notes), 0::bigint, 'an operator from another organization cannot read the note');
reset role;
reset request.jwt.claims;

select is((public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011') ->> 'live_limit')::integer, 100, 'the closed read declares the enforced live-note cap');
select ok(
  pg_catalog.jsonb_array_length(public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011') -> 'notes') = 1
  and not (public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011') -> 'notes' -> 0) ?| array['org_id', 'request_id'],
  'the closed read returns every live row without private ownership metadata'
);
select throws_ok(
  $$select public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000014')$$,
  'P0002', 'CLIENT_NOTES_NOT_FOUND', 'the service read applies the same per-client reach as RLS'
);

create temporary table original_note_time on commit drop as select updated_at from public.client_notes where id = (select id from note_identity);
select is(
  public.client_note_update('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', (select id from note_identity), '43000000-0000-4000-8000-000000000011', 'Confirm both the operating address and filing status.', (select updated_at from original_note_time)) ->> 'body',
  'Confirm both the operating address and filing status.', 'an update atomically returns the verified durable projection'
);
select is((select body from public.client_notes where id = (select id from note_identity)), 'Confirm both the operating address and filing status.', 'the edited body is durable');
select is((select count(*) from public.audit_log where action = 'client.note_updated' and subject_id = (select id from note_identity)), 1::bigint, 'an actual edit appends one audit event');
select throws_ok(
  $$select public.client_note_update('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', (select id from note_identity), '43000000-0000-4000-8000-000000000011', 'Confirm both the operating address and filing status.', (select updated_at from original_note_time))$$,
  '40001', 'CLIENT_NOTE_STALE', 'a same-body request cannot impersonate an earlier update without a mutation identity'
);
select is((select count(*) from public.audit_log where action = 'client.note_updated' and subject_id = (select id from note_identity)), 1::bigint, 'a stale same-body request cannot duplicate the audit event');
select throws_ok(
  $$select public.client_note_update('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', (select id from note_identity), '43000000-0000-4000-8000-000000000011', 'Overwrite a newer edit', (select updated_at from original_note_time))$$,
  '40001', 'CLIENT_NOTE_STALE', 'optimistic concurrency refuses a different edit based on stale content'
);

create temporary table edited_note_time on commit drop as select updated_at from public.client_notes where id = (select id from note_identity);
select ok((public.client_note_delete('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', (select id from note_identity), '43000000-0000-4000-8000-000000000011', (select updated_at from edited_note_time)) ->> 'deleted')::boolean, 'deletion atomically returns its verified tombstone outcome');
select is((select body from public.client_notes where id = (select id from note_identity)), '', 'deletion erases the private note body instead of retaining hidden content');
select ok((select deleted_at is not null and deleted_by = '43000000-0000-4000-8000-000000000011'::uuid from public.client_notes where id = (select id from note_identity)), 'deletion keeps an attributable tombstone');
select is((select count(*) from public.audit_log where action = 'client.note_deleted' and subject_id = (select id from note_identity)), 1::bigint, 'deletion appends one fixed-action audit event');
select throws_ok(
  $$select public.client_note_delete('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', (select id from note_identity), '43000000-0000-4000-8000-000000000011', (select updated_at from edited_note_time))$$,
  '40001', 'CLIENT_NOTE_STALE', 'a deleted tombstone cannot be claimed by a retry without a mutation identity'
);
select is((select count(*) from public.audit_log where action = 'client.note_deleted' and subject_id = (select id from note_identity)), 1::bigint, 'a stale delete retry cannot duplicate its audit event');
select is(pg_catalog.jsonb_array_length(public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011') -> 'notes'), 0, 'the complete operator read excludes the deleted note');
select ok(not exists (select 1 from public.audit_log where subject_id = (select id from note_identity) and meta::text ilike '%operating address%'), 'audit metadata never copies note content');
select throws_ok($$update public.client_notes set body = 'Restore deleted body' where id = (select id from note_identity)$$, '42501', 'CLIENT_NOTE_TOMBSTONE_IMMUTABLE', 'a deleted note cannot be restored by editing its tombstone');
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000041', 'Confirm the operating address before applying.')$$,
  '55000', 'CLIENT_NOTE_REQUEST_RETIRED', 'a deleted request identity remains retired and cannot create again'
);

do $block$
declare v_index integer;
begin
  for v_index in 1..100 loop
    perform public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000023', '43000000-0000-4000-8000-000000000011', extensions.gen_random_uuid(), 'Bounded note ' || v_index::text);
  end loop;
end;
$block$;
select is(pg_catalog.jsonb_array_length(public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000023', '43000000-0000-4000-8000-000000000011') -> 'notes'), 100, 'the complete read returns every retained live row at the enforced cap');
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000023', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000046', 'One note too many')$$,
  '54000', 'CLIENT_NOTE_LIMIT_REACHED', 'the lock-serialized trigger refuses a live row that the complete read could not reach'
);

select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000024', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000047', 'Archive boundary note');
do $block$
declare v_previous_marker text := pg_catalog.current_setting('app.governed_client_write', true);
begin
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  update public.clients
  set status = 'archived', archived_at = pg_catalog.clock_timestamp(),
      archived_by = '43000000-0000-4000-8000-000000000011'
  where id = '43000000-0000-4000-8000-000000000024';
  perform pg_catalog.set_config('app.governed_client_write', coalesce(v_previous_marker, ''), true);
end;
$block$;
select is(public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000024', '43000000-0000-4000-8000-000000000011') ->> 'write_blocked_reason', 'archived', 'an archived client remains readable but reports a disabled composer');
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000024', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000048', 'Write after archive')$$,
  '55000', 'CLIENT_NOTES_WRITE_BLOCKED', 'an archived client refuses a new private note'
);

select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000025', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000049', 'Erase this private note');
insert into public.privacy_requests (id, profile_id, org_id, client_id, kind, status, reviewed_at, reviewed_by, updated_at) values (
  '43000000-0000-4000-8000-000000000050', '43000000-0000-4000-8000-000000000017', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000025', 'deletion', 'in_review', pg_catalog.clock_timestamp(), '43000000-0000-4000-8000-000000000016', pg_catalog.clock_timestamp()
);
update public.privacy_requests set status = 'completed', completed_at = pg_catalog.clock_timestamp(), completed_by = '43000000-0000-4000-8000-000000000016', completion_note = 'Verified test erasure.', updated_at = pg_catalog.clock_timestamp() where id = '43000000-0000-4000-8000-000000000050';
select ok((select body = '' and deletion_reason = 'privacy_erasure' from public.client_notes where request_id = '43000000-0000-4000-8000-000000000049'), 'privacy completion atomically erases the retained note body');
select ok(
  public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000025', '43000000-0000-4000-8000-000000000011') ->> 'write_blocked_reason' = 'privacy_erased'
  and pg_catalog.jsonb_array_length(public.client_notes_list('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000025', '43000000-0000-4000-8000-000000000011') -> 'notes') = 0,
  'a completed deletion permanently disables the composer and exposes no note body'
);
select throws_ok(
  $$select public.client_note_create('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000025', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000051', 'Write after privacy completion')$$,
  '55000', 'CLIENT_NOTES_WRITE_BLOCKED', 'a completed deletion request permanently refuses later private-note writes'
);
select ok(
  pg_catalog.pg_get_functiondef('private.validate_client_note()'::regprocedure) ilike '%for update%',
  'the structural write guard serializes note creation with client privacy completion'
);

select * from finish();
rollback;
