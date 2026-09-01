begin;
set local search_path = public, extensions;

select plan(56);

select has_type('public', 'kb_import_status', 'import status enum exists');
select enum_has_labels('public', 'kb_import_status', array['running','succeeded','failed'], 'status enum is closed');
select has_table('public', 'kb_articles', 'articles table exists');
select has_table('public', 'kb_import_runs', 'runs table exists');
select has_table('public', 'kb_import_seen', 'seen table exists');
select columns_are('public', 'kb_articles', array[
  'id','source_article_id','title','body','source_url','source_updated_at','metadata',
  'source_checksum','embedding','embedding_version','embedded_at','first_imported_at',
  'last_imported_at','tombstoned_at'
], 'article columns are exact');
select columns_are('public', 'kb_import_runs', array[
  'id','driver','subject','window','idempotency_key','status','cursor','source_count',
  'added_count','changed_count','restored_count','unchanged_count','tombstoned_count',
  'embedded_count','error_code','started_at','updated_at','completed_at'
], 'run columns are exact');
select columns_are('public', 'kb_import_seen', array['run_id','source_article_id','source_checksum','seen_at'], 'seen columns are exact');
select is((select count(*)::integer from information_schema.columns where table_schema='public' and table_name='kb_articles' and column_name in ('org_id','client_id','profile_id','tenant_id','enrollment_id','analysis_id')), 0, 'articles carry no identity column');
select is((select count(*)::integer from pg_constraint where conrelid='public.kb_articles'::regclass and contype='f'), 0, 'articles carry no foreign key');

select is((select relrowsecurity from pg_class where oid='public.kb_articles'::regclass), true, 'article RLS enabled');
select is((select relforcerowsecurity from pg_class where oid='public.kb_articles'::regclass), true, 'article RLS forced');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.kb_import_runs'::regclass), true, 'run RLS enabled and forced');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.kb_import_seen'::regclass), true, 'seen RLS enabled and forced');
select is(has_table_privilege('authenticated','public.kb_articles','select'), true, 'authenticated can select articles');
select is(has_table_privilege('authenticated','public.kb_articles','insert'), false, 'authenticated cannot insert articles');
select is(has_table_privilege('authenticated','public.kb_articles','update'), false, 'authenticated cannot update articles');
select is(has_table_privilege('authenticated','public.kb_articles','delete'), false, 'authenticated cannot delete articles');
select is(has_table_privilege('authenticated','public.kb_import_runs','select'), false, 'authenticated cannot read runs');
select is(has_table_privilege('authenticated','public.kb_import_seen','select'), false, 'authenticated cannot read seen rows');
select is(has_function_privilege('authenticated','public.search_kb_articles(double precision[],integer)','execute'), true, 'authenticated can search');
select is(has_function_privilege('authenticated','public.kb_begin_import(text,text,text)','execute'), false, 'authenticated cannot begin imports');
select is(has_function_privilege('authenticated','public.kb_complete_import(uuid)','execute'), false, 'authenticated cannot complete imports');
select is((select bool_and(not p.prosecdef and p.provolatile='s' and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_kb_articles'), true, 'search is stable invoker with fixed path');
select is((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('kb_begin_import','kb_apply_article','kb_complete_import','kb_fail_import')), true, 'import RPCs are definers with fixed paths');

select is(private.kb_cosine_similarity(array_fill(0::float8,array[64]),array_fill(0::float8,array[64])), null, 'zero vectors do not rank');
select is(private.kb_cosine_similarity(array_fill(1::float8,array[63]),array_fill(1::float8,array[64])), null, 'wrong dimensions do not rank');

select throws_ok($$insert into public.kb_articles(source_article_id,title,body,source_url,metadata,source_checksum,embedding,embedding_version,embedded_at) values('bad checksum','T','B','https://example.test','{}','ABC',array_fill(0.1::float8,array[64]),'fixture-v1',now())$$, '23514', null, 'bad source/checksum is rejected');
select throws_ok($$insert into public.kb_articles(source_article_id,title,body,source_url,metadata,source_checksum,embedding,embedding_version,embedded_at) values('bad-vector','T','B','https://example.test','{}',repeat('a',64),array_fill(0.1::float8,array[63]),'fixture-v1',now())$$, '23514', null, 'bad vector dimension is rejected');
select throws_ok($$insert into public.kb_articles(source_article_id,title,body,source_url,metadata,source_checksum,embedding,embedding_version,embedded_at) values('bad-meta','T','B','https://example.test','{"identity":"x"}',repeat('a',64),array_fill(0.1::float8,array[64]),'fixture-v1',now())$$, '23514', null, 'unknown metadata is rejected');

create temporary table kb_test_ids(run_id uuid);
with run as (select (public.kb_begin_import('fixture','global','2026-W33')).id as id)
insert into kb_test_ids select id from run;
select is((select status::text from public.kb_import_runs where id=(select run_id from kb_test_ids)), 'running', 'begin creates running row');
select is((select id from public.kb_import_runs where id=(select run_id from kb_test_ids)), (public.kb_begin_import('fixture','global','2026-W33')).id, 'begin is idempotent');

select is(public.kb_apply_article((select run_id from kb_test_ids),'article-a','Alpha','Alpha body','https://example.test/a',null,'{"category":"alpha"}',repeat('a',64),array_prepend(1::float8,array_fill(0::float8,array[63])),'fixture-v1','cursor-1'), 'added', 'first application adds');
select is(public.kb_apply_article((select run_id from kb_test_ids),'article-b','Beta','Beta body','https://example.test/b',null,'{"category":"beta"}',repeat('b',64),array_append(array_fill(0::float8,array[63]),1::float8),'fixture-v1',''), 'added', 'second application adds and closes cursor');
select is((select source_count from public.kb_import_runs where id=(select run_id from kb_test_ids)), 2, 'source count follows durable seen set');
select is((select count(*)::integer from public.kb_import_seen where run_id=(select run_id from kb_test_ids)), 2, 'seen membership is durable');
select is((select source_article_id from public.search_kb_articles(array_prepend(1::float8,array_fill(0::float8,array[63])),8) limit 1), 'article-a', 'cosine search ranks exact match first');

create temporary table kb_stability as select embedding, embedded_at, source_checksum from public.kb_articles where source_article_id='article-a';
select is(public.kb_apply_article((select run_id from kb_test_ids),'article-a','Alpha','Alpha body','https://example.test/a',null,'{"category":"alpha"}',repeat('a',64),array_append(array_fill(0::float8,array[63]),1::float8),'fixture-v2',''), 'unchanged', 'unchanged application is classified');
select is((select embedding from public.kb_articles where source_article_id='article-a'), (select embedding from kb_stability), 'unchanged application preserves embedding');
select is((select embedded_at from public.kb_articles where source_article_id='article-a'), (select embedded_at from kb_stability), 'unchanged application preserves embedded timestamp');
select is((select source_checksum from public.kb_articles where source_article_id='article-a'), (select source_checksum from kb_stability), 'unchanged application preserves checksum');

select lives_ok($$select public.kb_complete_import((select run_id from kb_test_ids))$$, 'complete succeeds after terminal cursor');
select is((select status::text from public.kb_import_runs where id=(select run_id from kb_test_ids)), 'succeeded', 'complete marks succeeded');
select throws_ok($$select public.kb_apply_article((select run_id from kb_test_ids),'article-c','C','C','https://example.test/c',null,'{}',repeat('c',64),array_fill(0.1::float8,array[64]),'fixture-v1','')$$, '55000', 'KB_IMPORT_NOT_RUNNING', 'completed run rejects writes');

with run as (select (public.kb_begin_import('fixture','global','2026-W34')).id as id)
insert into kb_test_ids select id from run;
select is(public.kb_apply_article((select run_id from kb_test_ids order by ctid desc limit 1),'article-a','Alpha changed','Changed body','https://example.test/a',null,'{"category":"alpha"}',repeat('c',64),array_fill(0.125::float8,array[64]),'fixture-v2','cursor-open'), 'changed', 'changed content replaces article');
select lives_ok($$select public.kb_fail_import((select run_id from kb_test_ids order by ctid desc limit 1),'SOURCE_FAILED')$$, 'failure is recorded');
select is((select cursor from public.kb_import_runs where id=(select run_id from kb_test_ids order by ctid desc limit 1)), 'cursor-open', 'failure preserves cursor');
select is((select tombstoned_at is null from public.kb_articles where source_article_id='article-b'), true, 'failed import leaves unseen article active');

update public.kb_import_runs set cursor=null where id=(select run_id from kb_test_ids order by ctid desc limit 1);
select is((public.kb_begin_import('fixture','global','2026-W34')).status::text, 'running', 'failed run resumes');
select lives_ok($$select public.kb_complete_import((select run_id from kb_test_ids order by ctid desc limit 1))$$, 'resumed complete succeeds');
select is((select tombstoned_at is not null from public.kb_articles where source_article_id='article-b'), true, 'completion tombstones unseen article');
select is((select tombstoned_count from public.kb_import_runs where id=(select run_id from kb_test_ids order by ctid desc limit 1)), 1, 'completion records bounded tombstone count');

with run as (select (public.kb_begin_import('fixture','global','2026-W35')).id as id)
insert into kb_test_ids select id from run;
select is(public.kb_apply_article((select run_id from kb_test_ids order by ctid desc limit 1),'article-b','Beta','Beta body','https://example.test/b',null,'{"category":"beta"}',repeat('b',64),array_fill(0.25::float8,array[64]),'fixture-v9',''), 'restored', 'identical tombstoned row restores');
select is((select embedding_version from public.kb_articles where source_article_id='article-b'), 'fixture-v1', 'identical restore preserves embedding fields');

set local role authenticated;
select is((select count(*)::integer from public.kb_articles where source_article_id='article-b'), 1, 'authenticated sees restored active article');
select throws_ok($$insert into public.kb_articles(source_article_id,title,body,source_url,metadata,source_checksum,embedding,embedding_version,embedded_at) values('forbidden','T','B','https://example.test','{}',repeat('f',64),array_fill(0.1::float8,array[64]),'fixture-v1',now())$$, '42501', null, 'authenticated direct write is refused');
reset role;

select * from finish();
rollback;
