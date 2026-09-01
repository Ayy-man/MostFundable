begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ---------------------------------------------------------------------------
-- VAULT-01 / S2.2 acceptance criterion 1: "stats reconcile to seeded outcomes
-- exactly".
--
-- The expectation is computed from public.outcomes at test time by an
-- aggregation written independently of private.outcome_window_agg, and then
-- compared against what public.bank_read_model actually serves. Nothing here
-- transcribes a number from a reproduction, so a change to either the refresh
-- or the read model has to move both sides of the comparison to stay green —
-- which is the round-5 standard, and the reason this file is worth having on
-- top of 081's own tests.
-- ---------------------------------------------------------------------------

insert into public.clients(id, org_id, display_name)
values
  ('38400000-0000-4000-8000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Reconciliation client A'),
  ('38400000-0000-4000-8000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'Reconciliation client B'),
  ('38400000-0000-4000-8000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Reconciliation client C'),
  ('38400000-0000-4000-8000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'Reconciliation client D');

insert into public.banks_cache(bank_ref, name, application_questions)
values
  ('recon-alpha', 'Recon Alpha',
   '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},
     {"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'),
  ('recon-beta', 'Recon Beta',
   '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},
     {"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'),
  ('recon-silent', 'Recon Silent',
   '[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},
     {"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]');

-- One application per client and lender, because public.outcomes admits exactly
-- one counted outcome per application and public.applications exactly one row
-- per client and lender. The spread is deliberate: two organizations on one
-- lender so the pooling has something to pool, and four decision dates that
-- fall into different windows so d30, d60, d90, d183 and d365 cannot all be
-- accidentally equal.
insert into public.applications(id, client_id, bank_ref, created_by)
values
  ('38400000-0000-4000-8000-000000000011', '38400000-0000-4000-8000-000000000001', 'recon-alpha', 'a1000000-0000-0000-0000-000000000001'),
  ('38400000-0000-4000-8000-000000000012', '38400000-0000-4000-8000-000000000002', 'recon-alpha', 'a1000000-0000-0000-0000-000000000001'),
  ('38400000-0000-4000-8000-000000000013', '38400000-0000-4000-8000-000000000003', 'recon-alpha', 'a1000000-0000-0000-0000-000000000001'),
  ('38400000-0000-4000-8000-000000000014', '38400000-0000-4000-8000-000000000004', 'recon-alpha', 'a1000000-0000-0000-0000-000000000001'),
  ('38400000-0000-4000-8000-000000000015', '38400000-0000-4000-8000-000000000001', 'recon-beta', 'a1000000-0000-0000-0000-000000000001');

insert into public.outcomes(
  application_id, bank_ref, client_id, kind, amount_cents, decided_on, recorded_by, recorded_by_kind
)
values
  ('38400000-0000-4000-8000-000000000011', 'recon-alpha', '38400000-0000-4000-8000-000000000001',
   'approved', 250000, current_date - 3, 'a1000000-0000-0000-0000-000000000001', 'operator'),
  ('38400000-0000-4000-8000-000000000012', 'recon-alpha', '38400000-0000-4000-8000-000000000002',
   'approved', 410000, current_date - 45, 'a1000000-0000-0000-0000-000000000001', 'operator'),
  ('38400000-0000-4000-8000-000000000013', 'recon-alpha', '38400000-0000-4000-8000-000000000003',
   'withdrawn', null, current_date - 120, 'a1000000-0000-0000-0000-000000000001', 'operator'),
  ('38400000-0000-4000-8000-000000000014', 'recon-alpha', '38400000-0000-4000-8000-000000000004',
   'denied', null, current_date - 300, 'a1000000-0000-0000-0000-000000000001', 'operator'),
  ('38400000-0000-4000-8000-000000000015', 'recon-beta', '38400000-0000-4000-8000-000000000001',
   'denied', null, current_date - 200, 'a1000000-0000-0000-0000-000000000001', 'operator');

-- The queue is drained the way the running system drains it.
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

select ok(
  pg_temp.drain_outcome_refresh_jobs('recon-worker') > 0,
  'the refresh queue had work and it drained'
);

-- The independent expectation. One row per (lender, window) — including the
-- windows a lender has nothing in, because a window with no outcome is a zero
-- the read model must serve rather than a row it may omit — aggregated straight
-- off public.outcomes instead of through the jsonb round trip the refresh uses.
create view pg_temp.expected_windows as
select
  lender.bank_ref,
  window_spec.key,
  count(outcome.id) filter (where outcome.kind = 'approved')::bigint as approved,
  count(outcome.id) filter (where outcome.kind = 'denied')::bigint as denied,
  count(outcome.id) filter (where outcome.kind = 'withdrawn')::bigint as withdrawn,
  coalesce(sum(outcome.amount_cents) filter (where outcome.kind = 'approved'), 0)::bigint
    as approved_amount_cents
from (select distinct bank_ref from public.outcomes where state = 'counted') as lender
cross join (values ('d30', 30), ('d60', 60), ('d90', 90), ('d183', 183), ('d365', 365))
  as window_spec(key, days)
left join public.outcomes as outcome
  on outcome.bank_ref = lender.bank_ref
 and outcome.state = 'counted'
 and outcome.decided_on >= current_date - window_spec.days
group by lender.bank_ref, window_spec.key;

-- What the read model actually serves, unpacked from its jsonb.
create view pg_temp.served_windows as
select
  model.bank_ref,
  window_row.key,
  (window_row.value ->> 'approved')::bigint as approved,
  (window_row.value ->> 'denied')::bigint as denied,
  (window_row.value ->> 'withdrawn')::bigint as withdrawn,
  (window_row.value ->> 'approved_amount_cents')::bigint as approved_amount_cents
from public.bank_read_model as model
cross join lateral jsonb_each(model.windows) as window_row(key, value)
where model.windows is not null;

select is_empty(
  $$
    select coalesce(expected.bank_ref, served.bank_ref) as bank_ref,
           coalesce(expected.key, served.key) as window_key
    from pg_temp.expected_windows as expected
    full outer join pg_temp.served_windows as served
      on served.bank_ref = expected.bank_ref and served.key = expected.key
    where expected.bank_ref like 'recon-%' or served.bank_ref like 'recon-%'
    except
    select expected.bank_ref, expected.key
    from pg_temp.expected_windows as expected
    join pg_temp.served_windows as served
      on served.bank_ref = expected.bank_ref and served.key = expected.key
    where expected.approved = served.approved
      and expected.denied = served.denied
      and expected.withdrawn = served.withdrawn
      and expected.approved_amount_cents = served.approved_amount_cents
  $$,
  'VAULT-01: every window the read model serves reconciles to the recorded outcomes exactly'
);

-- The totals the surface's tiles are built from, same derivation.
select is(
  (select outcome_count_total from public.bank_read_model where bank_ref = 'recon-alpha'),
  (select count(*)::integer from public.outcomes where bank_ref = 'recon-alpha' and state = 'counted'),
  'the recorded-outcome total reconciles'
);
select is(
  (select approved_amount_cents_total from public.bank_read_model where bank_ref = 'recon-alpha'),
  (
    select coalesce(sum(amount_cents), 0)::bigint
    from public.outcomes
    where bank_ref = 'recon-alpha' and state = 'counted' and kind = 'approved'
  ),
  'the approved-amount total reconciles, pooled across both organizations'
);

-- Heat Level, re-derived from the outcomes rather than read back from the row
-- that produced it. §6: hot at three approvals in the trailing thirty days,
-- cold when nothing landed in the trailing ninety, warm otherwise.
select is(
  (select heat_level from public.bank_read_model where bank_ref = 'recon-alpha'),
  (
    select case
      when count(*) filter (
        where kind = 'approved' and decided_on >= current_date - 30
      ) >= 3 then 'hot'
      when count(*) filter (where decided_on >= current_date - 90) = 0 then 'cold'
      else 'warm'
    end
    from public.outcomes
    where bank_ref = 'recon-alpha' and state = 'counted'
  ),
  'Heat Level reconciles to the same rule read off the outcomes'
);
select is(
  (select heat_level from public.bank_read_model where bank_ref = 'recon-beta'),
  'cold',
  'a lender whose only outcome is older than ninety days reads cold'
);

-- A lender with no outcome at all is served, with null stats. The surface needs
-- the lender in the list; "the refresh has not run" and "there is nothing to
-- report" must stay distinguishable, which a zeroed row would destroy.
select is(
  (select count(*)::integer from public.bank_read_model where bank_ref = 'recon-silent'),
  1,
  'a lender with no recorded outcome is still in the catalog'
);
select is(
  (select windows from public.bank_read_model where bank_ref = 'recon-silent'),
  null,
  'and carries no stats rather than a zeroed row'
);

-- A withdrawn outcome that a platform admin later reviews out stops counting,
-- and the read model follows without Phase 8 recomputing anything.
select public.review_outcome(
  (select id from public.outcomes where bank_ref = 'recon-alpha' and kind = 'approved' and amount_cents = 250000),
  'removed',
  '00000000-0000-0000-0000-000000000001'
);
select ok(pg_temp.drain_outcome_refresh_jobs('recon-worker-2') >= 0, 'the correction drained');
select is(
  (select approved_amount_cents_total from public.bank_read_model where bank_ref = 'recon-alpha'),
  (
    select coalesce(sum(amount_cents), 0)::bigint
    from public.outcomes
    where bank_ref = 'recon-alpha' and state = 'counted' and kind = 'approved'
  ),
  'after a correction the read model still reconciles to what is counted'
);

select * from finish();
rollback;
