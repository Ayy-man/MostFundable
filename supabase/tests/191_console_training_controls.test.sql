begin;
set local search_path = public, extensions;

select plan(30);

select has_column('public','trainings','takedown_reason','training stores takedown reason');
select has_column('public','trainings','taken_down_by','training stores takedown actor');
select has_column('public','trainings','taken_down_at','training stores takedown time');
select has_function('public','update_training',array['uuid','uuid','training_audience','text','text','text'],'transactional update exists');
select has_function('public','unpublish_training',array['uuid','uuid','text'],'reason-aware unpublish exists');
select has_function('public','unpublish_training',array['uuid','uuid'],'compatibility unpublish exists');
select ok(has_function_privilege('service_role','public.update_training(uuid,uuid,public.training_audience,text,text,text)','execute'),'service role can update through RPC');
select ok(not has_function_privilege('authenticated','public.update_training(uuid,uuid,public.training_audience,text,text,text)','execute'),'browser role cannot update through RPC');
select ok(not has_function_privilege('anon','public.unpublish_training(uuid,uuid,text)','execute'),'anonymous cannot take down training');

insert into auth.users(id,email) values
 ('19100000-0000-4000-8000-000000000011','owner-a@training-console.test'),
 ('19100000-0000-4000-8000-000000000021','owner-b@training-console.test'),
 ('19100000-0000-4000-8000-000000000001','admin@training-console.test');
insert into public.orgs(id,name,slug) values
 ('19100000-0000-4000-8000-000000000101','Training Console A','training-console-a'),
 ('19100000-0000-4000-8000-000000000102','Training Console B','training-console-b');
insert into public.profiles(id,role,org_id,org_role,full_name,email) values
 ('19100000-0000-4000-8000-000000000011','operator_member','19100000-0000-4000-8000-000000000101','owner','Owner A','owner-a@training-console.test'),
 ('19100000-0000-4000-8000-000000000021','operator_member','19100000-0000-4000-8000-000000000102','owner','Owner B','owner-b@training-console.test'),
 ('19100000-0000-4000-8000-000000000001','platform_admin',null,null,'Platform Admin','admin@training-console.test')
on conflict (id) do update set role=excluded.role,org_id=excluded.org_id,org_role=excluded.org_role,full_name=excluded.full_name,email=excluded.email;
insert into public.trainings(
  id,org_id,audience,source,title,video_url,body,created_by,
  source_object_path,source_file_name,source_mime_type,source_size_bytes,source_uploaded_at
) values
 ('19100000-0000-4000-8000-000000000201','19100000-0000-4000-8000-000000000101','client','operator','Published row','https://www.youtube.com/watch?v=console','Body one','19100000-0000-4000-8000-000000000011',null,null,null,null,null),
 ('19100000-0000-4000-8000-000000000202','19100000-0000-4000-8000-000000000101','operator','operator','Draft row','https://vimeo.com/191','Body two','19100000-0000-4000-8000-000000000011',null,null,null,null,null),
 ('19100000-0000-4000-8000-000000000203',null,'operator','platform','Platform row','https://www.loom.com/share/console','Body three','19100000-0000-4000-8000-000000000001','19100000-0000-4000-8000-000000000203/source','platform-source.pdf','application/pdf',10,now());

select lives_ok($$select * from public.publish_training('19100000-0000-4000-8000-000000000201','19100000-0000-4000-8000-000000000011',true,'Approved console attestation')$$,'operator publishes before edit');
select lives_ok($$select * from public.update_training('19100000-0000-4000-8000-000000000201','19100000-0000-4000-8000-000000000011','client','Edited row','https://www.youtube.com/watch?v=console2','Edited body')$$,'owning operator edits published row');
select ok((select not published and published_at is null and published_by is null and not attested and attested_at is null and attestation_text is null from public.trainings where id='19100000-0000-4000-8000-000000000201'),'published edit clears complete publication evidence');
select is((select count(*)::integer from public.audit_log where subject_id='19100000-0000-4000-8000-000000000201' and action='training.updated'),1,'published edit writes one audit');

select lives_ok($$select * from public.update_training('19100000-0000-4000-8000-000000000202','19100000-0000-4000-8000-000000000011','operator','Draft edited','https://vimeo.com/192','Draft body edited')$$,'draft edit succeeds');
select ok((select not published and not attested and title='Draft edited' from public.trainings where id='19100000-0000-4000-8000-000000000202'),'draft edit remains draft');
select throws_ok($$select * from public.update_training('19100000-0000-4000-8000-000000000202','19100000-0000-4000-8000-000000000021','operator','Wrong org','https://vimeo.com/193','Wrong org')$$,'P0001','TRAINING_ACTOR_FORBIDDEN','foreign operator cannot edit');

select lives_ok($$select * from public.publish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001',true,'Approved platform attestation')$$,'admin publishes platform row');
select throws_ok($$select * from public.unpublish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001',null)$$,'P0001','TRAINING_TAKEDOWN_REASON_REQUIRED','admin reason is required');
select throws_ok($$select * from public.unpublish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001','   ')$$,'P0001','TRAINING_TAKEDOWN_REASON_REQUIRED','admin blank reason is rejected');
select throws_ok($$select * from public.unpublish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001')$$,'P0001','TRAINING_TAKEDOWN_REASON_REQUIRED','old signature rejects admin');
select lives_ok($$select * from public.unpublish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001','  Policy review required  ')$$,'admin takedown persists a reason');
select ok((select not published and takedown_reason='Policy review required' and taken_down_by='19100000-0000-4000-8000-000000000001' and taken_down_at is not null from public.trainings where id='19100000-0000-4000-8000-000000000203'),'admin evidence is complete and trimmed');

select lives_ok($$select * from public.publish_training('19100000-0000-4000-8000-000000000203','19100000-0000-4000-8000-000000000001',true,'Fresh platform attestation')$$,'fresh publish succeeds');
select ok((select published and takedown_reason is null and taken_down_by is null and taken_down_at is null from public.trainings where id='19100000-0000-4000-8000-000000000203'),'fresh publish clears stale takedown evidence');

select lives_ok($$select * from public.publish_training('19100000-0000-4000-8000-000000000202','19100000-0000-4000-8000-000000000011',true,'Approved operator attestation')$$,'operator draft can publish');
select lives_ok($$select * from public.unpublish_training('19100000-0000-4000-8000-000000000202','19100000-0000-4000-8000-000000000011')$$,'operator old signature remains compatible');
select ok((select not published and takedown_reason is null and taken_down_by is null and taken_down_at is null from public.trainings where id='19100000-0000-4000-8000-000000000202'),'operator unpublish stores no platform evidence');
select is((select count(*)::integer from public.audit_log where subject_id='19100000-0000-4000-8000-000000000203' and action='training.unpublished'),1,'admin takedown writes one audit');

select throws_ok($$update public.trainings set takedown_reason='reason' where id='19100000-0000-4000-8000-000000000201'$$,'23514',null,'partial takedown evidence violates shape');
select throws_ok($$update public.trainings set takedown_reason=repeat('x',1001),taken_down_by='19100000-0000-4000-8000-000000000001',taken_down_at=now() where id='19100000-0000-4000-8000-000000000201'$$,'23514',null,'oversized reason violates bound');

select * from finish();
rollback;
