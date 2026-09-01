begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select ok(
  pg_get_functiondef('public.support_list_threads(uuid,integer)'::regprocedure)
    like '%client.status = ''active''%',
  'the support queue excludes archived client threads'
);

select ok(
  pg_get_function_result('public.support_list_thread_digest(uuid,uuid,integer)'::regprocedure)
    like '%participant_message_count integer%',
  'the digest carries a participant-message count'
);

select ok(
  pg_get_function_result('public.support_list_thread_digest(uuid,uuid,integer)'::regprocedure)
    like '%internal_message_count integer%',
  'the digest carries an internal-note count'
);

select is(
  has_function_privilege('authenticated', 'public.support_list_thread_digest(uuid,uuid,integer)', 'execute'),
  false,
  'authenticated callers cannot invoke the actor-argument digest directly'
);

select is(
  has_function_privilege('service_role', 'public.support_list_thread_digest(uuid,uuid,integer)', 'execute'),
  true,
  'the server repository can invoke the digest'
);

select * from finish();
rollback;
