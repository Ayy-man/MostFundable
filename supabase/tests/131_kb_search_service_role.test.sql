begin;
select plan(2);
select ok(has_schema_privilege('service_role', 'private', 'USAGE'), 'service role can resolve the allow-listed KB helper');
select ok(has_function_privilege('service_role', 'private.kb_cosine_similarity(double precision[], double precision[])', 'EXECUTE'), 'service role can execute the KB similarity helper');
select * from finish();
rollback;
