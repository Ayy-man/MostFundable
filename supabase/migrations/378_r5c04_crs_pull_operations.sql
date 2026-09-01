-- R5C-04 — a crash between the CRS response and the first persistence commit must not buy the
-- reports again.
--
-- **The defect.** `createAndPersistResult` pulls and persists in one unguarded expression. A crash
-- after the provider answers leaves the durable job only `running`, so lease recovery re-runs
-- `softPull`. The sandbox adapter sends one POST per report code, CRS bills per report, and there
-- was nothing anywhere that could tell the second attempt the first one had already been served.
-- Traced: `first={claimed:1,succeeded:0,failed:1}`, then after a 61-second clock advance
-- `second={claimed:1,succeeded:1,failed:0}, pulls=2, attempts=2`.
--
-- The existing guard, `worker.test.ts`'s "replays an unknown persistence outcome without another
-- pull", faults *after* the commit, where replay correctly sees `status='persisted'` and never
-- reaches the pull at all. It proves a different interval.
--
-- **The record.** `crs_pull_operations` is one row per analysis operation, written *before* the
-- outbound call, so recovery can tell "already pulled" from "never pulled" instead of guessing.
-- `dispatched` means a request went out and we do not know what happened to it; `returned` means
-- the provider answered and we were billed; `indeterminate` means recovery gave up rather than
-- risk a second purchase. On a billable driver, any replay of a row that already exists makes no
-- outbound call at all and fails the job non-retryably, which is the conservative reading of an
-- ambiguous charge: stop and let a person decide rather than buy the reports again.
--
-- **The two rails bind absolutely here.** This table holds identifiers and classifications and
-- nothing else. There is no free-text column: `idempotency_key` is constrained to
-- `analysis:<uuid>`, `report_codes` to a three-letter-plus-four-digit code shape, and
-- `bureaus_returned` to the three bureau codes. No column can hold a subject name, an account, a
-- balance, a tradeline or any other fragment of a bureau file, and there is no jsonb column for one
-- to hide in. The report itself never leaves memory; the only legal exit remains `extractFeatures`.
--
-- The idempotency key is derived from the analysis operation rather than minted here, so it is the
-- same value on every attempt at that operation. It is the belt: if CRS honours it the repeat is
-- free at their end too. Whether they honour it is UNVERIFIED-FOR-ACCOUNT, which is exactly why the
-- durable record, and not the key, is what holds the invariant.

-- Outside the transaction: PostgreSQL forbids using a new enum value in the transaction that adds
-- it, and keeping the addition separate makes that impossible to get wrong later.
alter type public.analysis_job_error_code add value if not exists 'pull_indeterminate';

begin;

create table public.crs_pull_operations (
  analysis_run_id uuid primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  idempotency_key text not null unique,
  report_codes text[] not null,
  state text not null default 'dispatched',
  bureaus_returned text[],
  dispatched_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  constraint crs_pull_operations_state_closed check (
    state in ('dispatched', 'returned', 'indeterminate')
  ),
  -- Derived from the analysis operation, so it is stable across every attempt at it. The shape is
  -- pinned so nothing else can ever be smuggled through this column.
  constraint crs_pull_operations_key_shape check (
    idempotency_key = 'analysis:' || analysis_run_id::text
  ),
  -- Report codes only, and only the declared ones. The allow-list is the `ReportCode` union in the
  -- frozen `web/src/lib/crs/types.ts`; frozen is what makes an allow-list safe here rather than a
  -- drift risk, and a fourth code would fail loudly at the first insert instead of quietly widening
  -- what this column may hold. A CHECK cannot carry a subquery, so the shape is expressed as
  -- containment rather than a per-element pattern.
  constraint crs_pull_operations_codes_bounded check (
    cardinality(report_codes) between 1 and 3
    and report_codes <@ array['EQF1001', 'EXP1001', 'TUC3002']::text[]
  ),
  constraint crs_pull_operations_bureaus_bounded check (
    bureaus_returned is null
    or (
      cardinality(bureaus_returned) between 0 and 3
      and bureaus_returned <@ array['EQF', 'EXP', 'TUC']::text[]
    )
  ),
  constraint crs_pull_operations_settlement_shape check (
    (state = 'dispatched' and settled_at is null and bureaus_returned is null)
    or (state = 'returned' and settled_at is not null and bureaus_returned is not null)
    or (state = 'indeterminate' and settled_at is not null and bureaus_returned is null)
  ),
  constraint crs_pull_operations_settlement_order check (
    settled_at is null or settled_at >= dispatched_at
  )
);

create index crs_pull_operations_client_idx
  on public.crs_pull_operations(client_id, dispatched_at desc);

alter table public.crs_pull_operations enable row level security;
alter table public.crs_pull_operations force row level security;
revoke all on table public.crs_pull_operations from public, anon, authenticated, service_role;
grant select on table public.crs_pull_operations to service_role;

-- R5A-01. A durable operation record a product invariant depends on continuing to exist, so it is
-- inside 374's boundary and takes the boundary's treatment here.
create trigger crs_pull_operations_no_truncate
before truncate on public.crs_pull_operations
for each statement execute function public.append_only_guard();
alter table public.crs_pull_operations
  enable always trigger crs_pull_operations_no_truncate;

-- =================================================================================================
-- The pre-call record
-- =================================================================================================

create function public.crs_pull_operation_begin(
  p_client_id uuid,
  p_analysis_run_id uuid,
  p_report_codes text[]
) returns table (idempotency_key text, state text, replay boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_key text := 'analysis:' || p_analysis_run_id::text;
  v_existing public.crs_pull_operations;
begin
  insert into public.crs_pull_operations (
    analysis_run_id, client_id, idempotency_key, report_codes
  ) values (
    p_analysis_run_id, p_client_id, v_key,
    array(select distinct unnest(p_report_codes) order by 1)
  )
  on conflict (analysis_run_id) do nothing;

  if found then
    return query select v_key, 'dispatched'::text, false;
    return;
  end if;

  select operation.* into strict v_existing
  from public.crs_pull_operations as operation
  where operation.analysis_run_id = p_analysis_run_id
  for update;

  -- A run id belongs to exactly one client. A caller arriving with the other one is a defect, not
  -- a replay, and must never be handed the first client's operation.
  if v_existing.client_id <> p_client_id then
    raise exception using errcode = '22023', message = 'CRS_PULL_OPERATION_CLIENT_MISMATCH';
  end if;

  return query select v_existing.idempotency_key, v_existing.state, true;
end;
$fn$;

create function public.crs_pull_operation_returned(
  p_client_id uuid,
  p_analysis_run_id uuid,
  p_bureaus text[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.crs_pull_operations
  set state = 'returned',
      bureaus_returned = coalesce(p_bureaus, array[]::text[]),
      settled_at = pg_catalog.clock_timestamp()
  where analysis_run_id = p_analysis_run_id
    and client_id = p_client_id
    and state = 'dispatched';
  return found;
end;
$fn$;

create function public.crs_pull_operation_indeterminate(
  p_client_id uuid,
  p_analysis_run_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.crs_pull_operations
  set state = 'indeterminate',
      settled_at = pg_catalog.clock_timestamp()
  where analysis_run_id = p_analysis_run_id
    and client_id = p_client_id
    and state = 'dispatched';
  return found;
end;
$fn$;

revoke all on function public.crs_pull_operation_begin(uuid, uuid, text[])
  from public, anon, authenticated;
revoke all on function public.crs_pull_operation_returned(uuid, uuid, text[])
  from public, anon, authenticated;
revoke all on function public.crs_pull_operation_indeterminate(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.crs_pull_operation_begin(uuid, uuid, text[]) to service_role;
grant execute on function public.crs_pull_operation_returned(uuid, uuid, text[]) to service_role;
grant execute on function public.crs_pull_operation_indeterminate(uuid, uuid) to service_role;

commit;
