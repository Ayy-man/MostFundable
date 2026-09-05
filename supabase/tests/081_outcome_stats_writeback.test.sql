begin;

set local search_path = public, extensions;

select plan(64);

-- Phase 8, 2026-08-19: migration 383 gave public.applications.bank_ref a foreign
-- key to public.banks_cache, so the lender handles this file files applications
-- under need catalog rows. Seeded here rather than in seed.sql because each
-- pgTAP file is its own transaction and rolls this back with everything else.
insert into public.banks_cache (bank_ref, name, application_questions)
select handle, handle, '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'::jsonb
from unnest(array['cold-bank-gamma', 'record-bank-delta', 'shared-bank-alpha', 'solo-bank-beta']) as handle
on conflict (bank_ref) do nothing;

-- ---------------------------------------------------------------------------
-- Structure.
-- ---------------------------------------------------------------------------

select has_table('public', 'bank_outcome_stats', 'lender stats table exists');
select has_table('public', 'bank_retrieval_index', 'retrieval index table exists');
select has_table('public', 'outcome_refresh_jobs', 'refresh queue table exists');
select has_table('public', 'vault_writeback_outbox', 'write-back outbox table exists');
select has_table('public', 'outcome_notifications', 'operator notification table exists');
select has_type('public', 'outcome_job_status', 'refresh job status enum exists');

select is(
  (
    select relation.relkind::text
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'bank_outcome_stats'
  ),
  'r',
  'lender stats is an ordinary table, not a materialized view, so a refresh can be scoped to one bank'
);

-- Criterion 1's structural half. `condeferrable` and `condeferred` prove the key
-- is genuinely deferred, and `confupdtype = a` (NO ACTION) is what catches a
-- later edit to `on update restrict`, which reads as the stronger choice and
-- would quietly make the deferral a lie (pre-flight P-04).
select results_eq(
  $$
    select condeferrable, condeferred, confupdtype::text collate "C"
    from pg_constraint
    where conname = 'bank_retrieval_index_stats_fk'
  $$,
  $$ values (true, true, 'a'::text collate "C") $$,
  'the stats-to-index foreign key is deferrable, deferred, and NO ACTION on update'
);

select is(
  (
    select bool_and(function.prosecdef and function.proconfig @> array['search_path=""'])
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname in (
        'enqueue_outcome_refresh_job',
        'claim_outcome_refresh_job',
        'run_outcome_refresh_job',
        'fail_outcome_refresh_job',
        'record_outcome',
        'review_outcome'
      )
  ),
  true,
  'every new RPC is security definer with a fixed search path'
);

-- ---------------------------------------------------------------------------
-- Access. A queue row and an outbox row each name one outcome and belong to no
-- surface; the aggregate carries no tenant column and is what everyone is meant
-- to see.
-- ---------------------------------------------------------------------------

select is(
  has_table_privilege('anon', 'public.outcome_refresh_jobs', 'select'),
  false,
  'anonymous cannot read the refresh queue'
);
select is(
  has_table_privilege('anon', 'public.vault_writeback_outbox', 'select'),
  false,
  'anonymous cannot read the write-back outbox'
);
select is(
  has_table_privilege('authenticated', 'public.outcome_refresh_jobs', 'select'),
  false,
  'an operator cannot read the refresh queue either'
);
select is(
  has_table_privilege('authenticated', 'public.vault_writeback_outbox', 'select'),
  false,
  'an operator cannot read the write-back outbox'
);
select is(
  has_table_privilege('authenticated', 'public.bank_outcome_stats', 'select'),
  true,
  'the lender aggregate is readable by every operator, which is the product'
);
select is(
  has_function_privilege('authenticated', 'public.claim_outcome_refresh_job(text,integer)', 'execute'),
  false,
  'an operator cannot lease a refresh job'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.review_outcome(uuid,public.outcome_review_state,uuid)',
    'execute'
  ),
  true,
  'the review RPC is reachable from a session; its own platform-admin check is the gate'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two organizations sharing one bank, so the cross-tenant aggregate
-- has something to aggregate.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('bc000000-0000-0000-0000-000000000011', 'operator.one@outcome-stats.example'),
  ('bc000000-0000-0000-0000-000000000012', 'consumer.one@outcome-stats.example'),
  ('bc000000-0000-0000-0000-000000000013', 'admin@outcome-stats.example'),
  ('bc000000-0000-0000-0000-000000000021', 'operator.two@outcome-stats.example'),
  ('bc000000-0000-0000-0000-000000000022', 'consumer.two@outcome-stats.example'),
  ('bc000000-0000-0000-0000-000000000023', 'consumer.three@outcome-stats.example');

insert into public.orgs (id, name, slug)
values
  ('bc000000-0000-0000-0000-000000000001', 'Outcome Stats Org One', 'outcome-stats-org-one'),
  ('bc000000-0000-0000-0000-000000000002', 'Outcome Stats Org Two', 'outcome-stats-org-two');

insert into public.profiles (id, role, org_id, org_role, full_name, email)
values
  (
    'bc000000-0000-0000-0000-000000000011', 'operator_member',
    'bc000000-0000-0000-0000-000000000001', 'owner',
    'Outcome Stats Operator One', 'operator.one@outcome-stats.example'
  ),
  (
    'bc000000-0000-0000-0000-000000000012', 'consumer',
    'bc000000-0000-0000-0000-000000000001', null,
    'Outcome Stats Consumer One', 'consumer.one@outcome-stats.example'
  ),
  (
    'bc000000-0000-0000-0000-000000000013', 'platform_admin',
    null, null,
    'Outcome Stats Admin', 'admin@outcome-stats.example'
  ),
  (
    'bc000000-0000-0000-0000-000000000021', 'operator_member',
    'bc000000-0000-0000-0000-000000000002', 'owner',
    'Outcome Stats Operator Two', 'operator.two@outcome-stats.example'
  ),
  (
    'bc000000-0000-0000-0000-000000000022', 'consumer',
    'bc000000-0000-0000-0000-000000000002', null,
    'Outcome Stats Consumer Two', 'consumer.two@outcome-stats.example'
  ),
  (
    'bc000000-0000-0000-0000-000000000023', 'consumer',
    'bc000000-0000-0000-0000-000000000001', null,
    'Outcome Stats Consumer Three', 'consumer.three@outcome-stats.example'
  )
on conflict (id) do update
set
  role = excluded.role,
  org_id = excluded.org_id,
  org_role = excluded.org_role,
  full_name = excluded.full_name,
  email = excluded.email;

insert into public.clients (id, org_id, consumer_profile_id, display_name, assigned_to)
values
  (
    'bc000000-0000-0000-0000-000000000101',
    'bc000000-0000-0000-0000-000000000001',
    'bc000000-0000-0000-0000-000000000012',
    'Outcome Stats Client One',
    'bc000000-0000-0000-0000-000000000011'
  ),
  (
    'bc000000-0000-0000-0000-000000000102',
    'bc000000-0000-0000-0000-000000000002',
    'bc000000-0000-0000-0000-000000000022',
    'Outcome Stats Client Two',
    'bc000000-0000-0000-0000-000000000021'
  ),
  (
    'bc000000-0000-0000-0000-000000000103',
    'bc000000-0000-0000-0000-000000000001',
    'bc000000-0000-0000-0000-000000000023',
    'Outcome Stats Client Three',
    'bc000000-0000-0000-0000-000000000011'
  );

insert into public.applications (id, client_id, bank_ref, created_by)
values
  ('bc000000-0000-0000-0000-000000000201', 'bc000000-0000-0000-0000-000000000101',
   'shared-bank-alpha', 'bc000000-0000-0000-0000-000000000011'),
  ('bc000000-0000-0000-0000-000000000202', 'bc000000-0000-0000-0000-000000000102',
   'shared-bank-alpha', 'bc000000-0000-0000-0000-000000000021'),
  ('bc000000-0000-0000-0000-000000000203', 'bc000000-0000-0000-0000-000000000101',
   'solo-bank-beta', 'bc000000-0000-0000-0000-000000000011'),
  ('bc000000-0000-0000-0000-000000000204', 'bc000000-0000-0000-0000-000000000103',
   'shared-bank-alpha', 'bc000000-0000-0000-0000-000000000011'),
  ('bc000000-0000-0000-0000-000000000205', 'bc000000-0000-0000-0000-000000000102',
   'solo-bank-beta', 'bc000000-0000-0000-0000-000000000021'),
  ('bc000000-0000-0000-0000-000000000206', 'bc000000-0000-0000-0000-000000000101',
   'cold-bank-gamma', 'bc000000-0000-0000-0000-000000000011'),
  ('bc000000-0000-0000-0000-000000000207', 'bc000000-0000-0000-0000-000000000103',
   'record-bank-delta', 'bc000000-0000-0000-0000-000000000011');

-- A drain loop, because that is how the queue is actually consumed; claiming one
-- job by hand would exercise a path the running system never takes.
create function pg_temp.drain_outcome_refresh_jobs(p_worker text)
returns integer
language plpgsql
as $$
declare
  v_job public.outcome_refresh_jobs;
  v_drained integer := 0;
begin
  loop
    select * into v_job from public.claim_outcome_refresh_job(p_worker, 60);
    exit when v_job.id is null;
    perform public.run_outcome_refresh_job(v_job.id, p_worker);
    v_drained := v_drained + 1;
    exit when v_drained > 50;
  end loop;
  return v_drained;
end;
$$;

-- ---------------------------------------------------------------------------
-- Criterion 1, atomicity. On a bank of its own so nothing else perturbs it.
-- ---------------------------------------------------------------------------

insert into public.bank_outcome_stats (bank_ref, stats_version, windows, heat_level)
values (
  'fk-proof-bank',
  1,
  '{"d30":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
    "d60":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
    "d90":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
    "d183":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
    "d365":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0}}'::jsonb,
  'cold'
);

insert into public.bank_retrieval_index (bank_ref, stats_version, document, document_fingerprint)
select 'fk-proof-bank', 1, seed.document, md5(seed.document::text)
from (
  select '{"bank_ref":"fk-proof-bank","heat_level":"cold","last_outcome_at":null,
           "approved_amount_cents_total":0,"outcome_count_total":0,
           "windows":{"d30":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
                      "d60":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
                      "d90":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
                      "d183":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0},
                      "d365":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0}}}'::jsonb
    as document
) as seed;

savepoint drift;
update public.bank_outcome_stats set stats_version = 2 where bank_ref = 'fk-proof-bank';

select throws_ok(
  'set constraints all immediate',
  '23503',
  null,
  'advancing the stats version without the index is rejected the moment the deferral is lifted'
);

rollback to savepoint drift;

savepoint together;
update public.bank_outcome_stats set stats_version = 2 where bank_ref = 'fk-proof-bank';
update public.bank_retrieval_index set stats_version = 2 where bank_ref = 'fk-proof-bank';

select lives_ok(
  'set constraints all immediate',
  'advancing both together commits, which is what makes the deferral usable rather than merely strict'
);

rollback to savepoint together;

-- pgTAP runs a whole file inside one transaction, and `lives_ok` executes its
-- SQL in a subtransaction that commits, so the SET CONSTRAINTS above outlives
-- the savepoint that scoped the updates around it. Every refresh in the running
-- system gets a fresh transaction at the deferred default, so put the session
-- back there before the rest of the file exercises one.
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Allow-lists. Rejection is by omission from the list rather than by naming
-- forbidden keys, so a key nobody thought of is rejected too.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.bank_retrieval_index
    set document = document || '{"client_id":"bc000000-0000-0000-0000-000000000101"}'::jsonb
    where bank_ref = 'fk-proof-bank'
  $$,
  '23514',
  null,
  'a retrieval document naming a client is rejected'
);

select lives_ok(
  $$
    update public.bank_retrieval_index
    set document = document || '{"heat_level":"warm"}'::jsonb
    where bank_ref = 'fk-proof-bank'
  $$,
  'a retrieval document using only allow-listed keys is accepted'
);

select throws_ok(
  $$
    update public.bank_outcome_stats
    set windows = windows || '{"d45":{"approved":0,"denied":0,"withdrawn":0,"approved_amount_cents":0}}'::jsonb
    where bank_ref = 'fk-proof-bank'
  $$,
  '23514',
  null,
  'a sixth stats window is rejected, so the document and the fee model cannot silently disagree'
);

-- ---------------------------------------------------------------------------
-- The queue key.
-- ---------------------------------------------------------------------------

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000301',
  'bc000000-0000-0000-0000-000000000201',
  'shared-bank-alpha',
  'bc000000-0000-0000-0000-000000000101',
  'approved', 2500000,
  'bc000000-0000-0000-0000-000000000011', 'operator', current_date
);

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000302',
  'bc000000-0000-0000-0000-000000000202',
  'shared-bank-alpha',
  'bc000000-0000-0000-0000-000000000102',
  'denied',
  'bc000000-0000-0000-0000-000000000021', 'operator', current_date
);

select is(
  (select count(distinct idempotency_key)::integer from public.outcome_refresh_jobs
   where bank_ref = 'shared-bank-alpha'),
  2,
  'two outcomes on one bank enqueue two distinct jobs'
);

select is(
  (select "window" from public.outcome_refresh_jobs
   where change_id = 'bc000000-0000-0000-0000-000000000301'),
  'change:bc000000-0000-0000-0000-000000000301',
  'the job window names the triggering row, per INTERFACES §7 and ask-3'
);

select is(
  (select subject from public.outcome_refresh_jobs
   where change_id = 'bc000000-0000-0000-0000-000000000301'),
  'bank:shared-bank-alpha',
  'the job subject names the bank'
);

select is(
  (select count(*)::integer from public.enqueue_outcome_refresh_job(
     'shared-bank-alpha', 'bc000000-0000-0000-0000-000000000301')),
  1,
  're-enqueueing the same bank and triggering row returns the job already queued'
);

select is(
  (select count(*)::integer from public.outcome_refresh_jobs where bank_ref = 'shared-bank-alpha'),
  2,
  'and creates no second row, because the idempotency key is a unique constraint'
);

-- ---------------------------------------------------------------------------
-- Criterion 1, the run. One job writes both tables at one version.
-- ---------------------------------------------------------------------------

select is(
  pg_temp.drain_outcome_refresh_jobs('worker-081') >= 2,
  true,
  'the drain claims and runs every queued job'
);

select is(
  (select count(*)::integer from public.outcome_refresh_jobs
   where bank_ref = 'shared-bank-alpha' and status <> 'succeeded'),
  0,
  'every refresh job for the bank reached a terminal successful state'
);

select is(
  (
    select stats.stats_version = index_row.stats_version
    from public.bank_outcome_stats as stats
    join public.bank_retrieval_index as index_row on index_row.bank_ref = stats.bank_ref
    where stats.bank_ref = 'shared-bank-alpha'
  ),
  true,
  'the stats row and the index row carry the same version, because one job wrote both'
);

-- G-11-03: the aggregate crosses tenancy deliberately, and only the aggregate.
select is(
  (select outcome_count_total from public.bank_outcome_stats where bank_ref = 'shared-bank-alpha'),
  2,
  'two organizations'' outcomes land in one bank row, which is the shared funding brain'
);

select is(
  (select approved_amount_cents_total from public.bank_outcome_stats
   where bank_ref = 'shared-bank-alpha'),
  2500000::bigint,
  'the approved amount total sums only approved outcomes'
);

select is(
  (
    select document::text ~ 'bc000000-0000-0000-0000-'
    from public.bank_retrieval_index
    where bank_ref = 'shared-bank-alpha'
  ),
  false,
  'the retrieval document names no client, organization or profile'
);

select is(
  (
    select count(*)::integer
    from public.bank_retrieval_index as index_row,
      lateral jsonb_object_keys(index_row.document) as document_key
    where index_row.bank_ref = 'shared-bank-alpha'
      and document_key in ('client_id', 'org_id', 'profile_id', 'stats_version')
  ),
  0,
  'the document carries no identifier key and no version key, so equal content fingerprints equal'
);

-- ---------------------------------------------------------------------------
-- Criterion 1, idempotency: version, rebuild moment and fingerprint all survive
-- a second run untouched when nothing changed.
-- ---------------------------------------------------------------------------

create temporary table idempotency_probe as
select stats.stats_version, index_row.rebuilt_at, index_row.document_fingerprint
from public.bank_outcome_stats as stats
join public.bank_retrieval_index as index_row on index_row.bank_ref = stats.bank_ref
where stats.bank_ref = 'shared-bank-alpha';

do $$
begin
  perform public.enqueue_outcome_refresh_job(
    'shared-bank-alpha', 'bc000000-0000-0000-0000-0000000009a1');
  perform pg_temp.drain_outcome_refresh_jobs('worker-081');
end;
$$;

select is(
  (select stats_version from public.bank_outcome_stats where bank_ref = 'shared-bank-alpha'),
  (select stats_version from idempotency_probe),
  'a second run with no data change leaves the stats version untouched'
);

select is(
  (select rebuilt_at from public.bank_retrieval_index where bank_ref = 'shared-bank-alpha'),
  (select rebuilt_at from idempotency_probe),
  'and leaves the rebuild moment untouched, so nothing was written at all'
);

select is(
  (select document_fingerprint from public.bank_retrieval_index where bank_ref = 'shared-bank-alpha'),
  (select document_fingerprint from idempotency_probe),
  'and leaves the fingerprint untouched, which is what short-circuited the write'
);

-- The companion assertion, without which an implementation that never writes
-- anything at all would pass the three above.
insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000303',
  'bc000000-0000-0000-0000-000000000203',
  'solo-bank-beta',
  'bc000000-0000-0000-0000-000000000101',
  'approved', 1000000,
  'bc000000-0000-0000-0000-000000000011', 'operator', current_date
);

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000305',
  'bc000000-0000-0000-0000-000000000204',
  'shared-bank-alpha',
  'bc000000-0000-0000-0000-000000000103',
  'approved', 400000,
  'bc000000-0000-0000-0000-000000000011', 'operator', current_date
);

do $$ begin perform pg_temp.drain_outcome_refresh_jobs('worker-081'); end; $$;

select is(
  (
    select stats.stats_version > (select stats_version from idempotency_probe)
    from public.bank_outcome_stats as stats
    where stats.bank_ref = 'shared-bank-alpha'
  ),
  true,
  'a run after a real change advances the version, so the short-circuit is not inertia'
);

-- ---------------------------------------------------------------------------
-- Criterion 2. The decision, the tagged write-back and the notification are one
-- transaction, and the correction path is out of an operator's reach.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'bc000000-0000-0000-0000-000000000011')::text,
  true
);

select throws_ok(
  $$
    select * from public.review_outcome(
      'bc000000-0000-0000-0000-000000000301', 'approved',
      'bc000000-0000-0000-0000-000000000011')
  $$,
  '42501',
  null,
  'an operator cannot decide a correction, including on the entry it made itself'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'bc000000-0000-0000-0000-000000000013')::text,
  true
);

select results_eq(
  $$
    select result collate "C", review_state::text collate "C", outbox_state collate "C"
    from public.review_outcome(
      'bc000000-0000-0000-0000-000000000301', 'approved',
      'bc000000-0000-0000-0000-000000000013')
  $$,
  $$ values ('decided'::text collate "C", 'approved'::text collate "C", 'recorded'::text collate "C") $$,
  'a platform admin approves the review and the write-back is staged, not sent'
);

select results_eq(
  $$
    select result collate "C", review_state::text collate "C"
    from public.review_outcome(
      'bc000000-0000-0000-0000-000000000301', 'approved',
      'bc000000-0000-0000-0000-000000000013')
  $$,
  $$ values ('unchanged'::text collate "C", 'approved'::text collate "C") $$,
  'repeating a decision already in force changes nothing and reports that plainly'
);

reset role;

select results_eq(
  $$
    select count(*)::integer, min(source) collate "C", min(state) collate "C", min(target) collate "C"
    from public.vault_writeback_outbox
    where outcome_id = 'bc000000-0000-0000-0000-000000000301'
  $$,
  $$
    values (1, 'mostfundable'::text collate "C", 'recorded'::text collate "C",
            'bank_datapoints'::text collate "C")
  $$,
  'exactly one outbox row, tagged mostfundable, recorded rather than claiming a delivery that never happened'
);

select throws_ok(
  $$
    update public.vault_writeback_outbox set source = 'other'
    where outcome_id = 'bc000000-0000-0000-0000-000000000301'
  $$,
  '23514',
  null,
  'APPS-03: the attribution tag is a constraint, so it cannot be spelled any other way'
);

select throws_ok(
  $$
    update public.vault_writeback_outbox
    set payload = payload || '{"client_id":"bc000000-0000-0000-0000-000000000101"}'::jsonb
    where outcome_id = 'bc000000-0000-0000-0000-000000000301'
  $$,
  '23514',
  null,
  'a consumer identifier has no key to travel to VAULT in'
);

select results_eq(
  $$
    select count(*)::integer, min(kind::text) collate "C", min(recipient_profile_id::text) collate "C"
    from public.outcome_notifications
    where outcome_id = 'bc000000-0000-0000-0000-000000000301'
  $$,
  $$
    values (1, 'outcome_review_approved'::text collate "C",
            'bc000000-0000-0000-0000-000000000011'::text collate "C")
  $$,
  'exactly one notification to the client''s assigned operator, and the repeat produced no second one'
);

select is(
  (
    select count(*)::integer from public.outcome_refresh_jobs
    where bank_ref = 'shared-bank-alpha'
      and change_id = md5(
        (select id from public.outcome_reviews
         where outcome_id = 'bc000000-0000-0000-0000-000000000301')::text || ':approved'
      )::uuid
  ),
  1,
  'the admin decision enqueues a job of its own, keyed on the decision rather than the review row'
);

select is(
  (select count(distinct idempotency_key)::integer from public.outcome_refresh_jobs
   where bank_ref = 'shared-bank-alpha'),
  (select count(*)::integer from public.outcome_refresh_jobs
   where bank_ref = 'shared-bank-alpha'),
  'every job on the bank has its own key, so the decision was not swallowed as a duplicate create'
);

select is(
  (select count(*)::integer from public.audit_log
   where action = 'outcome.review.decided'
     and subject_id = 'bc000000-0000-0000-0000-000000000301'),
  1,
  'the decision writes exactly one audit row, in the same transaction as the decision'
);

-- The correction itself: the tombstone, the second notification and the
-- recompute APPS-04 requires.
do $$ begin perform pg_temp.drain_outcome_refresh_jobs('worker-081'); end; $$;

create temporary table pre_correction as
select stats_version from public.bank_outcome_stats where bank_ref = 'shared-bank-alpha';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'bc000000-0000-0000-0000-000000000013')::text,
  true
);

select results_eq(
  $$
    select result collate "C", review_state::text collate "C", outbox_state
    from public.review_outcome(
      'bc000000-0000-0000-0000-000000000301', 'removed',
      'bc000000-0000-0000-0000-000000000013')
  $$,
  $$ values ('decided'::text collate "C", 'removed'::text collate "C", null::text) $$,
  'the admin correction is applied and the unsent write-back is withdrawn with it'
);

reset role;

select results_eq(
  $$
    select state::text collate "C", removed_by::text collate "C", removed_at is not null
    from public.outcomes where id = 'bc000000-0000-0000-0000-000000000301'
  $$,
  $$
    values ('removed'::text collate "C",
            'bc000000-0000-0000-0000-000000000013'::text collate "C", true)
  $$,
  'the corrected outcome is tombstoned rather than deleted, and names the admin who corrected it'
);

select is(
  (select count(*)::integer from public.vault_writeback_outbox
   where outcome_id = 'bc000000-0000-0000-0000-000000000301'),
  0,
  'nothing had left the system, so the staged write-back goes with the correction'
);

select is(
  (select count(*)::integer from public.outcome_notifications
   where outcome_id = 'bc000000-0000-0000-0000-000000000301'
     and kind = 'outcome_review_removed'),
  1,
  'the operator is told its entry was corrected'
);

select is(
  pg_temp.drain_outcome_refresh_jobs('worker-081') >= 1,
  true,
  'the correction enqueued a job of its own, which the drain consumes'
);

select is(
  (
    select stats.stats_version > (select stats_version from pre_correction)
    from public.bank_outcome_stats as stats
    where stats.bank_ref = 'shared-bank-alpha'
  ),
  true,
  'APPS-04: an admin correction recomputes the lender stats'
);

select is(
  (
    select stats.stats_version = index_row.stats_version
    from public.bank_outcome_stats as stats
    join public.bank_retrieval_index as index_row on index_row.bank_ref = stats.bank_ref
    where stats.bank_ref = 'shared-bank-alpha'
  ),
  true,
  'APPS-04: and the retrieval index moved with it, inside the same job'
);

select is(
  (select outcome_count_total from public.bank_outcome_stats where bank_ref = 'shared-bank-alpha'),
  2,
  'the tombstoned outcome no longer counts toward the lender aggregate'
);

-- ---------------------------------------------------------------------------
-- Heat, with the threshold named rather than implied.
-- ---------------------------------------------------------------------------

select is(
  (select heat_level from public.bank_outcome_stats where bank_ref = 'shared-bank-alpha'),
  'warm',
  'one recent approval is warm, short of the named hot threshold of three'
);

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000306',
  'bc000000-0000-0000-0000-000000000205',
  'solo-bank-beta',
  'bc000000-0000-0000-0000-000000000102',
  'approved', 900000,
  'bc000000-0000-0000-0000-000000000021', 'operator', current_date
);

insert into public.outcomes (
  id, application_id, bank_ref, client_id, kind, amount_cents,
  recorded_by, recorded_by_kind, decided_on
) values (
  'bc000000-0000-0000-0000-000000000307',
  'bc000000-0000-0000-0000-000000000206',
  'cold-bank-gamma',
  'bc000000-0000-0000-0000-000000000101',
  'approved', 100000,
  'bc000000-0000-0000-0000-000000000011', 'operator', current_date - 200
);

do $$ begin perform pg_temp.drain_outcome_refresh_jobs('worker-081'); end; $$;

select is(
  (select heat_level from public.bank_outcome_stats where bank_ref = 'cold-bank-gamma'),
  'cold',
  'no outcome at all in the trailing ninety days reads as cold'
);

select is(
  (select (windows -> 'd365' ->> 'approved')::integer from public.bank_outcome_stats
   where bank_ref = 'cold-bank-gamma'),
  1,
  'but the twelve-month window still carries it, so cold is a recency statement and not an empty one'
);

-- ---------------------------------------------------------------------------
-- Recording an outcome through the RPC the service layer will call.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'bc000000-0000-0000-0000-000000000011')::text,
  true
);

select isnt(
  (
    select public.record_outcome(
      'bc000000-0000-0000-0000-000000000207', 'approved', 550000, current_date)
  ),
  null,
  'an operator records an outcome through the RPC and gets its identifier back'
);

reset role;

select results_eq(
  $$
    select state::text collate "C", recorded_by_kind::text collate "C",
           recorded_by::text collate "C", amount_cents
    from public.outcomes
    where application_id = 'bc000000-0000-0000-0000-000000000207'
  $$,
  $$
    values ('counted'::text collate "C", 'operator'::text collate "C",
            'bc000000-0000-0000-0000-000000000011'::text collate "C", 550000::bigint)
  $$,
  'APPS-02: it counts on entry, attributed to the session that recorded it, with no review passed'
);

select is(
  (
    select review.state::text
    from public.outcome_reviews as review
    join public.outcomes as outcome on outcome.id = review.outcome_id
    where outcome.application_id = 'bc000000-0000-0000-0000-000000000207'
  ),
  'pending',
  'and its correction record is created alongside it, pending and harmless'
);

select is(
  (select count(*)::integer from public.outcome_refresh_jobs where bank_ref = 'record-bank-delta'),
  1,
  'the recorded outcome enqueued exactly one refresh job for its lender'
);

-- ---------------------------------------------------------------------------
-- What this phase deliberately does not do, and the one capability demo mode
-- cannot reach over HTTP (G-11-06).
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where (
        (namespace.nspname = 'public' and function.proname in (
          'enqueue_outcome_refresh_job', 'claim_outcome_refresh_job',
          'run_outcome_refresh_job', 'fail_outcome_refresh_job',
          'record_outcome', 'review_outcome'))
        or (namespace.nspname = 'private' and function.proname in (
          'audit_outcome_refresh_transition', 'retrieval_document_valid',
          'vault_writeback_payload_valid', 'bank_stats_windows_valid',
          'outcome_window_agg', 'enqueue_outcome_refresh_on_outcome',
          'enqueue_outcome_refresh_on_review'))
      )
      and function.prosrc ~ '(stage_history|stage_entered_at|clients\.stage)'
  ),
  0,
  'nothing in this phase writes the tracker stage machinery; that seam belongs to Phase 6'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', 'bc000000-0000-0000-0000-000000000011')::text,
  true
);

-- Manual moves step one stage at a time (migration 441), so walk the client up to Ready first.
select public.tracker_transition_client_stage(
  'bc000000-0000-0000-0000-000000000101', 'optimization', 'onboarding',
  'bc000000-0000-0000-0000-000000000011', 'manual', null);
select public.tracker_transition_client_stage(
  'bc000000-0000-0000-0000-000000000101', 'ready', 'optimization',
  'bc000000-0000-0000-0000-000000000011', 'manual', null);

select results_eq(
  $$
    select result collate "C", current_stage::text collate "C"
    from public.tracker_transition_client_stage(
      'bc000000-0000-0000-0000-000000000101', 'applying', 'ready',
      'bc000000-0000-0000-0000-000000000011', 'manual', null)
  $$,
  $$ values ('transitioned'::text collate "C", 'applying'::text collate "C") $$,
  'the Applying move works at the RPC level with a real session, which is the capability demo mode cannot reach'
);

reset role;

select * from finish();

rollback;
