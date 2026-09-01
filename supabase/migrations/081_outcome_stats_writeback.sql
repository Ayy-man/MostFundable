-- 081_outcome_stats_writeback.sql — Phase 11 (S2.3), APPS-03 and APPS-04.
--
--   APPS-03  every outcome this platform records is written back to the funding
--            brain tagged as ours. The tag is `check (source = 'mostfundable')`
--            on public.vault_writeback_outbox, so an untagged row cannot exist
--            regardless of which driver, worker or hand-written statement
--            produced it. The outbox is the durable intent; the delivery arm is
--            key-arrival work (KA-11-1) and is deliberately not attempted here.
--
--   APPS-04  a platform-admin correction recomputes the lender stats. The
--            aggregate and the retrieval document it feeds are written by one
--            job in one transaction at one version, and the foreign key between
--            them is deferred so the pair can never be observed apart.
--
-- Everything is additive. No object here writes `clients.stage`,
-- `clients.stage_entered_at` or `public.stage_history`: the Applying and Funded
-- moves belong to Phase 6's `public.tracker_transition_client_stage`, and
-- restating that machinery would give the tracker two owners.
--
-- What is deliberately NOT here: a materialized view. `refresh materialized
-- view` has no per-bank scope, so one outcome on one lender would rebuild every
-- lender's row, and `concurrently` needs a unique index plus a full pass anyway.
-- An ordinary table lets a job touch exactly the bank that changed.

create type public.outcome_job_status as enum ('queued', 'running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- Allow-list validators. Each rejects an unexpected key by omission rather than
-- by naming forbidden ones, which is the stronger direction: a key nobody
-- thought of is rejected too. They follow migration 003's
-- `private.derived_features_valid` shape exactly, including the exception arm
-- that turns a malformed value into `false` instead of an error.
-- ---------------------------------------------------------------------------

create function private.bank_stats_windows_valid(p_windows jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  window_key text;
  window_value jsonb;
  metric_key text;
  metric_value numeric;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'object' then
    return false;
  end if;

  -- Exactly the five windows, no more and no fewer. A sixth window would reach
  -- the retrieval document and the fee model without either knowing about it.
  if (select array_agg(key order by key collate "C") from jsonb_object_keys(p_windows) as key)
     is distinct from array['d183', 'd30', 'd365', 'd60', 'd90'] then
    return false;
  end if;

  for window_key, window_value in select key, p_windows -> key from jsonb_object_keys(p_windows) as key
  loop
    if jsonb_typeof(window_value) <> 'object' then
      return false;
    end if;

    if (select array_agg(key order by key collate "C") from jsonb_object_keys(window_value) as key)
       is distinct from array['approved', 'approved_amount_cents', 'denied', 'withdrawn'] then
      return false;
    end if;

    for metric_key in select key from jsonb_object_keys(window_value) as key
    loop
      if jsonb_typeof(window_value -> metric_key) <> 'number' then
        return false;
      end if;
      metric_value := (window_value ->> metric_key)::numeric;
      if metric_value < 0 or metric_value <> trunc(metric_value) then
        return false;
      end if;
    end loop;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create function private.retrieval_document_valid(p_document jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  document_key text;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    return false;
  end if;

  for document_key in select key from jsonb_object_keys(p_document) as key
  loop
    -- No client_id, org_id, profile_id or free-text field appears here, which is
    -- what keeps a shared, cross-tenant retrieval corpus from carrying one
    -- operator's book into another operator's answers.
    if document_key not in (
      'approved_amount_cents_total',
      'bank_ref',
      'heat_level',
      'last_outcome_at',
      'outcome_count_total',
      'stats_version',
      'windows'
    ) then
      return false;
    end if;
  end loop;

  if not (p_document ? 'bank_ref' and p_document ? 'heat_level' and p_document ? 'windows') then
    return false;
  end if;

  if jsonb_typeof(p_document -> 'bank_ref') <> 'string'
    or (p_document ->> 'heat_level') not in ('hot', 'warm', 'cold') then
    return false;
  end if;

  return private.bank_stats_windows_valid(p_document -> 'windows');
exception
  when others then
    return false;
end;
$$;

create function private.vault_writeback_payload_valid(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  payload_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  for payload_key in select key from jsonb_object_keys(p_payload) as key
  loop
    if payload_key not in (
      'amount_cents',
      'bank_ref',
      'decided_on',
      'outcome_kind',
      'stats_version'
    ) then
      return false;
    end if;
  end loop;

  if not (p_payload ? 'bank_ref' and p_payload ? 'outcome_kind' and p_payload ? 'decided_on') then
    return false;
  end if;

  if (p_payload ->> 'outcome_kind') not in ('approved', 'denied', 'withdrawn') then
    return false;
  end if;

  if p_payload ? 'amount_cents'
    and jsonb_typeof(p_payload -> 'amount_cents') not in ('number', 'null') then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

comment on function private.retrieval_document_valid(jsonb) is
  'The privacy boundary of the shared funding brain, expressed as a check '
  'constraint rather than as a convention. A retrieval document is per-lender '
  'and cross-tenant by design (G-11-03); the allow-list is what makes that '
  'safe, because no consumer or operator identifier has a key to travel in.';

-- Migrations 012 and 052 exist because Postgres evaluates a check constraint as
-- the CALLING role, not as the table owner. The same applies to all three
-- validators below, so the grant is part of the same statement that creates the
-- constraints rather than a later fix.
grant execute on function private.bank_stats_windows_valid(jsonb) to service_role, authenticated;
grant execute on function private.retrieval_document_valid(jsonb) to service_role, authenticated;
grant execute on function private.vault_writeback_payload_valid(jsonb) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- The lender aggregate and the retrieval document it feeds.
-- ---------------------------------------------------------------------------

create table public.bank_outcome_stats (
  bank_ref text primary key,
  stats_version bigint not null default 1,
  windows jsonb not null,
  heat_level text not null,
  last_outcome_at timestamptz,
  approved_amount_cents_total bigint not null default 0,
  outcome_count_total integer not null default 0,
  computed_at timestamptz not null default now(),
  constraint bank_outcome_stats_bank_ref_shape check (bank_ref ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  constraint bank_outcome_stats_windows_valid check (private.bank_stats_windows_valid(windows)),
  constraint bank_outcome_stats_heat_level_check check (heat_level in ('hot', 'warm', 'cold')),
  constraint bank_outcome_stats_version_positive check (stats_version > 0),
  constraint bank_outcome_stats_totals_nonnegative check (
    approved_amount_cents_total >= 0 and outcome_count_total >= 0
  ),
  constraint bank_outcome_stats_version_unique unique (bank_ref, stats_version)
);

comment on table public.bank_outcome_stats is
  'Per-lender outcome counts across five fixed windows, aggregated across every '
  'tenant on the platform. Crossing tenancy here is the product — one '
  'operator''s clients benefit from what every other operator learned about a '
  'lender — and the row carries no client, organization or profile column, so '
  'the aggregate is the only thing that crosses. Phase 8 reads this table for '
  'the bank read model (ask-2); it does not recompute it.';

comment on column public.bank_outcome_stats.heat_level is
  'hot when the trailing-thirty-day approved count reaches the named threshold '
  'of three, cold when nothing at all landed in the trailing ninety days, warm '
  'otherwise. The threshold is a constant inside '
  'public.run_outcome_refresh_job, not a magic number spread across callers.';

create table public.bank_retrieval_index (
  bank_ref text primary key,
  stats_version bigint not null,
  document jsonb not null,
  document_fingerprint text not null,
  rebuilt_at timestamptz not null default now(),
  constraint bank_retrieval_index_document_valid check (private.retrieval_document_valid(document)),
  constraint bank_retrieval_index_fingerprint_shape check (document_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint bank_retrieval_index_stats_fk
    foreign key (bank_ref, stats_version)
    references public.bank_outcome_stats (bank_ref, stats_version)
    on update no action
    on delete cascade
    deferrable initially deferred
);

comment on constraint bank_retrieval_index_stats_fk on public.bank_retrieval_index is
  'Deferred on purpose. A refresh writes the aggregate and then the document, '
  'so between the two statements the index row still points at the previous '
  'version; an immediate constraint would reject the first write and force the '
  'job to drop the constraint or write the pair out of order. Deferred, the '
  'mismatch is legal inside the transaction and impossible outside it, which is '
  'exactly APPS-04''s "both or neither". It must stay NO ACTION on update: '
  'pre-flight P-04 records that a RESTRICT action fires immediately even on a '
  'deferrable constraint, so switching to the stricter-looking word would '
  'silently make the deferral a lie.';

comment on column public.bank_retrieval_index.document_fingerprint is
  'md5 of the stored document, used only as a change detector so an unchanged '
  'refresh writes nothing and the version stops drifting. md5 rather than '
  'sha256 because pre-flight P-05 could not verify pgcrypto is available in '
  'this build, and a change detector needs no cryptographic strength. The '
  'document deliberately omits stats_version: a version inside the content '
  'would change on every run and make every run look like a change.';

-- ---------------------------------------------------------------------------
-- The refresh queue. Same shape as migration 030's analysis_jobs, because a
-- second queue with different lease semantics is a second thing to operate.
-- ---------------------------------------------------------------------------

create table public.outcome_refresh_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  job text not null default 'outcomes.refresh_stats',
  bank_ref text not null,
  change_id uuid not null,
  subject text generated always as ('bank:' || bank_ref) stored,
  "window" text generated always as ('change:' || change_id::text) stored,
  idempotency_key text generated always as (
    job || '|bank:' || bank_ref || '|change:' || change_id::text
  ) stored,
  status public.outcome_job_status not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outcome_refresh_jobs_job_check check (job = 'outcomes.refresh_stats'),
  constraint outcome_refresh_jobs_attempt_count_check check (attempt_count >= 0),
  constraint outcome_refresh_jobs_error_code_length check (
    error_code is null or char_length(error_code) between 1 and 64
  ),
  constraint outcome_refresh_jobs_failed_error_check check (
    status <> 'failed' or error_code is not null
  ),
  constraint outcome_refresh_jobs_lease_shape check (
    (lease_owner is null and lease_until is null)
    or (lease_owner is not null and lease_until is not null)
  ),
  constraint outcome_refresh_jobs_idempotency_unique unique (idempotency_key)
);

create index outcome_refresh_jobs_claim_idx
  on public.outcome_refresh_jobs (available_at, created_at)
  where status = 'queued';

create index outcome_refresh_jobs_bank_ref_idx
  on public.outcome_refresh_jobs (bank_ref, created_at desc);

comment on column public.outcome_refresh_jobs."window" is
  'INTERFACES §7 gives an analysis job a date window; a refresh job has no date '
  'to window, so it carries change:<change_id> — the outcome row that was '
  'inserted, or, for a correction, the md5 of the review row and the state it '
  'reached (ask-3). Naming the decision rather than the review row is what '
  'keeps a create, an approval and a later correction on one outcome from '
  'collapsing into one idempotency key and losing the recompute APPS-04 '
  'requires.';

-- ---------------------------------------------------------------------------
-- The write-back intent and the operator notification.
-- ---------------------------------------------------------------------------

create table public.vault_writeback_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  outcome_id uuid not null unique references public.outcomes(id) on delete cascade,
  bank_ref text not null,
  target text not null,
  source text not null default 'mostfundable',
  payload jsonb not null,
  state text not null default 'recorded',
  recorded_at timestamptz not null default now(),
  delivered_at timestamptz,
  failure_code text,
  constraint vault_writeback_outbox_source_check check (source = 'mostfundable'),
  constraint vault_writeback_outbox_target_check check (target in ('data_points', 'bank_datapoints')),
  constraint vault_writeback_outbox_state_check check (state in ('recorded', 'delivered', 'failed')),
  constraint vault_writeback_outbox_payload_valid check (private.vault_writeback_payload_valid(payload)),
  constraint vault_writeback_outbox_delivered_shape check (
    state <> 'delivered' or delivered_at is not null
  ),
  constraint vault_writeback_outbox_failed_shape check (
    state <> 'failed' or failure_code is not null
  ),
  constraint vault_writeback_outbox_failure_code_length check (
    failure_code is null or char_length(failure_code) between 1 and 64
  )
);

create index vault_writeback_outbox_state_idx
  on public.vault_writeback_outbox (state, recorded_at)
  where state <> 'delivered';

comment on constraint vault_writeback_outbox_source_check on public.vault_writeback_outbox is
  'APPS-03''s attribution tag, as a constraint rather than a default a caller '
  'could override. VAULT is a shared funding brain with other writers; a row '
  'that cannot say where it came from is a row nobody can retract.';

comment on column public.vault_writeback_outbox.target is
  'Both table names come from CURRENT-STATE §44 and are UNVERIFIED-FOR-ACCOUNT '
  '(pre-flight P-08): nobody on this side has seen the live VAULT schema, so '
  'the column list a delivery would need is a guess. The outbox exists so the '
  'intent is durable and replayable the day the credentials arrive (KA-11-1); '
  'nothing here attempts a delivery.';

comment on column public.vault_writeback_outbox.state is
  'recorded means staged and never sent. The fixture driver leaves every row '
  'here, which is the honest state for a system with no VAULT credentials — a '
  'row marked delivered on a fixture run would be a false claim in the '
  'database.';

create table public.outcome_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  kind public.outcome_notification_kind not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint outcome_notifications_unique unique (outcome_id, recipient_profile_id, kind)
);

create index outcome_notifications_recipient_unread_idx
  on public.outcome_notifications (recipient_profile_id, created_at desc)
  where read_at is null;

comment on table public.outcome_notifications is
  'Phase-scoped on purpose (ask-6). There is no general notification table in '
  'the merged stack, and inventing one here would hand a cross-cutting concern '
  'to the phase least able to see its other callers. The unique key is what '
  'makes a repeated admin decision produce no second alert.';

-- ---------------------------------------------------------------------------
-- Row security.
-- ---------------------------------------------------------------------------

alter table public.bank_outcome_stats enable row level security;
alter table public.bank_outcome_stats force row level security;
alter table public.bank_retrieval_index enable row level security;
alter table public.bank_retrieval_index force row level security;
alter table public.outcome_refresh_jobs enable row level security;
alter table public.outcome_refresh_jobs force row level security;
alter table public.vault_writeback_outbox enable row level security;
alter table public.vault_writeback_outbox force row level security;
alter table public.outcome_notifications enable row level security;
alter table public.outcome_notifications force row level security;

revoke all on table public.bank_outcome_stats from anon, authenticated;
revoke all on table public.bank_retrieval_index from anon, authenticated;
revoke all on table public.outcome_refresh_jobs from anon, authenticated;
revoke all on table public.vault_writeback_outbox from anon, authenticated;
revoke all on table public.outcome_notifications from anon, authenticated;

-- The aggregate and the document carry no tenant column and are meant to be
-- read by everyone; the queue and the outbox name individual outcomes and
-- belong to no surface at all.
grant select on table public.bank_outcome_stats to authenticated;
grant select on table public.bank_retrieval_index to authenticated;
grant select on table public.outcome_notifications to authenticated;
grant update (read_at) on table public.outcome_notifications to authenticated;

grant all on table public.bank_outcome_stats to service_role;
grant all on table public.bank_retrieval_index to service_role;
grant all on table public.outcome_refresh_jobs to service_role;
grant all on table public.vault_writeback_outbox to service_role;
grant all on table public.outcome_notifications to service_role;

create policy bank_outcome_stats_select_all
on public.bank_outcome_stats
for select
to authenticated
using (true);

create policy bank_retrieval_index_select_all
on public.bank_retrieval_index
for select
to authenticated
using (true);

create policy outcome_notifications_select_own
on public.outcome_notifications
for select
to authenticated
using (recipient_profile_id = (select private.auth_profile_id()));

create policy outcome_notifications_update_own
on public.outcome_notifications
for update
to authenticated
using (recipient_profile_id = (select private.auth_profile_id()))
with check (recipient_profile_id = (select private.auth_profile_id()));

-- ---------------------------------------------------------------------------
-- Queue mechanics.
-- ---------------------------------------------------------------------------

create function private.audit_outcome_refresh_transition(
  p_job public.outcome_refresh_jobs,
  p_from_state text,
  p_to_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (
    action,
    subject_type,
    subject_id,
    meta
  )
  values (
    'outcome.refresh.' || p_to_state,
    'outcome_refresh_job',
    p_job.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'job', p_job.job,
        'from_state', p_from_state,
        'to_state', p_to_state,
        'reason_code', p_job.error_code
      )
    )
  );
end;
$$;

create function public.enqueue_outcome_refresh_job(
  p_bank_ref text,
  p_change_id uuid
)
returns setof public.outcome_refresh_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.outcome_refresh_jobs;
begin
  insert into public.outcome_refresh_jobs (bank_ref, change_id)
  values (p_bank_ref, p_change_id)
  on conflict (idempotency_key) do nothing
  returning * into v_job;

  if v_job.id is null then
    -- Already queued for this bank and this triggering row. Return the existing
    -- job rather than raising: the caller asked for a refresh to be pending,
    -- and one is.
    select * into v_job
    from public.outcome_refresh_jobs
    where idempotency_key =
      'outcomes.refresh_stats|bank:' || p_bank_ref || '|change:' || p_change_id::text;
  else
    perform private.audit_outcome_refresh_transition(v_job, null, 'queued');
  end if;

  return next v_job;
end;
$$;

create function public.claim_outcome_refresh_job(
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns setof public.outcome_refresh_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.outcome_refresh_jobs;
begin
  if p_worker_id is null or char_length(p_worker_id) = 0 then
    raise exception using errcode = '22023', message = 'a refresh worker must identify itself';
  end if;

  update public.outcome_refresh_jobs as job
  set
    status = 'running',
    attempt_count = job.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
    updated_at = now()
  where job.id = (
    select candidate.id
    from public.outcome_refresh_jobs as candidate
    where candidate.status = 'queued'
      and candidate.available_at <= now()
    order by candidate.available_at, candidate.created_at
    for update skip locked
    limit 1
  )
  returning job.* into v_job;

  if v_job.id is null then
    return;
  end if;

  perform private.audit_outcome_refresh_transition(v_job, 'queued', 'running');
  return next v_job;
end;
$$;

create function public.fail_outcome_refresh_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry boolean default true,
  p_retry_after_seconds integer default 30
)
returns setof public.outcome_refresh_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.outcome_refresh_jobs;
begin
  update public.outcome_refresh_jobs as job
  set
    status = case when p_retry then 'queued'::public.outcome_job_status
                  else 'failed'::public.outcome_job_status end,
    available_at = case when p_retry
                        then now() + make_interval(secs => greatest(p_retry_after_seconds, 1))
                        else job.available_at end,
    lease_owner = null,
    lease_until = null,
    error_code = coalesce(nullif(p_error_code, ''), 'unspecified'),
    updated_at = now()
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
  returning job.* into v_job;

  if v_job.id is null then
    raise exception using
      errcode = '55000',
      message = 'refresh job is not held by this worker';
  end if;

  perform private.audit_outcome_refresh_transition(
    v_job, 'running', case when p_retry then 'queued' else 'failed' end
  );
  return next v_job;
end;
$$;

create function private.outcome_window_agg(p_rows jsonb, p_since date)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'approved', count(*) filter (where entry.kind = 'approved'),
    'denied', count(*) filter (where entry.kind = 'denied'),
    'withdrawn', count(*) filter (where entry.kind = 'withdrawn'),
    'approved_amount_cents',
      coalesce(sum(entry.amount_cents) filter (where entry.kind = 'approved'), 0)
  )
  from jsonb_to_recordset(p_rows) as entry(kind text, amount_cents bigint, decided_on date)
  where entry.decided_on >= p_since;
$$;

-- ---------------------------------------------------------------------------
-- The refresh itself. One job, one bank, both tables, one version.
-- ---------------------------------------------------------------------------

create function public.run_outcome_refresh_job(
  p_job_id uuid,
  p_worker_id text
)
returns setof public.outcome_refresh_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Ask-4: the Heat Level threshold is named once, here, rather than repeated
  -- as a literal in the aggregate, the UI copy and the fee model.
  c_hot_approved_last_30 constant integer := 3;
  v_job public.outcome_refresh_jobs;
  v_today date := current_date;
  v_windows jsonb;
  v_outcome_count integer;
  v_approved_total bigint;
  v_last_outcome_at timestamptz;
  v_recent_count integer;
  v_heat text;
  v_document jsonb;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_next_version bigint;
begin
  select * into v_job
  from public.outcome_refresh_jobs as job
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
    and job.lease_until > now()
  for update;

  if v_job.id is null then
    raise exception using
      errcode = '55000',
      message = 'refresh job is not held by this worker under a live lease';
  end if;

  select
    jsonb_build_object(
      'd30', private.outcome_window_agg(outcome_rows.rows, v_today - 30),
      'd60', private.outcome_window_agg(outcome_rows.rows, v_today - 60),
      'd90', private.outcome_window_agg(outcome_rows.rows, v_today - 90),
      'd183', private.outcome_window_agg(outcome_rows.rows, v_today - 183),
      'd365', private.outcome_window_agg(outcome_rows.rows, v_today - 365)
    ),
    outcome_rows.total_count,
    outcome_rows.total_approved_amount,
    outcome_rows.last_at
  into v_windows, v_outcome_count, v_approved_total, v_last_outcome_at
  from (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', outcome.kind::text,
            'amount_cents', coalesce(outcome.amount_cents, 0),
            'decided_on', outcome.decided_on
          )
        ),
        '[]'::jsonb
      ) as rows,
      count(*)::integer as total_count,
      coalesce(sum(outcome.amount_cents) filter (where outcome.kind = 'approved'), 0)::bigint
        as total_approved_amount,
      max(outcome.created_at) as last_at
    from public.outcomes as outcome
    where outcome.bank_ref = v_job.bank_ref
      and outcome.state = 'counted'
  ) as outcome_rows;

  v_recent_count :=
    (v_windows -> 'd90' ->> 'approved')::integer
    + (v_windows -> 'd90' ->> 'denied')::integer
    + (v_windows -> 'd90' ->> 'withdrawn')::integer;

  if (v_windows -> 'd30' ->> 'approved')::integer >= c_hot_approved_last_30 then
    v_heat := 'hot';
  elsif v_recent_count = 0 then
    -- A lender with no history at all reads as cold rather than being skipped;
    -- a null last-outcome moment is a fact about the lender, not a missing row.
    v_heat := 'cold';
  else
    v_heat := 'warm';
  end if;

  v_document := jsonb_build_object(
    'bank_ref', v_job.bank_ref,
    'heat_level', v_heat,
    'windows', v_windows,
    'last_outcome_at', to_jsonb(v_last_outcome_at),
    'approved_amount_cents_total', v_approved_total,
    'outcome_count_total', v_outcome_count
  );
  v_fingerprint := md5(v_document::text);

  select index_row.document_fingerprint
  into v_existing_fingerprint
  from public.bank_retrieval_index as index_row
  where index_row.bank_ref = v_job.bank_ref;

  if v_existing_fingerprint is distinct from v_fingerprint then
    select coalesce(stats.stats_version, 0) + 1
    into v_next_version
    from (select 1) as anchor
    left join public.bank_outcome_stats as stats on stats.bank_ref = v_job.bank_ref;

    insert into public.bank_outcome_stats as stats (
      bank_ref, stats_version, windows, heat_level, last_outcome_at,
      approved_amount_cents_total, outcome_count_total, computed_at
    )
    values (
      v_job.bank_ref, v_next_version, v_windows, v_heat, v_last_outcome_at,
      v_approved_total, v_outcome_count, now()
    )
    on conflict (bank_ref) do update
    set
      stats_version = excluded.stats_version,
      windows = excluded.windows,
      heat_level = excluded.heat_level,
      last_outcome_at = excluded.last_outcome_at,
      approved_amount_cents_total = excluded.approved_amount_cents_total,
      outcome_count_total = excluded.outcome_count_total,
      computed_at = excluded.computed_at;

    -- Between the two statements the index row still names the previous
    -- version. That is legal only because the foreign key is deferred, and it
    -- is the whole reason it is.
    insert into public.bank_retrieval_index as index_row (
      bank_ref, stats_version, document, document_fingerprint, rebuilt_at
    )
    values (v_job.bank_ref, v_next_version, v_document, v_fingerprint, now())
    on conflict (bank_ref) do update
    set
      stats_version = excluded.stats_version,
      document = excluded.document,
      document_fingerprint = excluded.document_fingerprint,
      rebuilt_at = excluded.rebuilt_at;
  end if;

  update public.outcome_refresh_jobs as job
  set
    status = 'succeeded',
    lease_owner = null,
    lease_until = null,
    updated_at = now()
  where job.id = v_job.id
  returning job.* into v_job;

  perform private.audit_outcome_refresh_transition(v_job, 'running', 'succeeded');
  return next v_job;
end;
$$;

comment on function public.run_outcome_refresh_job(uuid, text) is
  'Recomputes one lender from public.outcomes and writes the aggregate and the '
  'retrieval document in one transaction at one version. When the content '
  'fingerprint is unchanged it writes nothing at all, so a burst of jobs on a '
  'quiet lender does not walk the version forward and invalidate every cached '
  'document downstream.';

-- ---------------------------------------------------------------------------
-- Recording an outcome and correcting one.
-- ---------------------------------------------------------------------------

create function public.record_outcome(
  p_application_id uuid,
  p_kind public.outcome_kind,
  p_amount_cents bigint,
  p_decided_on date,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.applications;
  v_client public.clients;
  v_actor uuid;
  v_actor_role public.app_role;
  v_actor_org uuid;
  v_outcome_id uuid;
begin
  select * into v_application
  from public.applications as application
  where application.id = p_application_id;

  if v_application.id is null then
    raise exception using errcode = 'P0002', message = 'application not found';
  end if;

  select * into v_client
  from public.clients as client
  where client.id = v_application.client_id;

  if (select auth.role()) = 'authenticated' then
    v_actor := (select auth.uid());
    if p_actor is not null and p_actor <> v_actor then
      raise exception using
        errcode = '42501',
        message = 'an outcome is recorded under the session that recorded it';
    end if;
    if not (select private.can_access_client(v_application.client_id)) then
      raise exception using errcode = '42501', message = 'client is not reachable';
    end if;
  elsif (select auth.role()) = 'service_role' then
    -- With FEATURE_REAL_AUTH off the server holds the session and calls as the
    -- service role, so there is no auth.uid() for private.can_access_client to
    -- resolve and it would return false for every client. The actor therefore
    -- arrives explicitly, and the check below is an organization-boundary floor
    -- rather than a restatement of the Phase 1 helper: it is deliberately
    -- coarser, blocking cross-organization writes outright while leaving the
    -- per-assignment reach to the service layer, exactly where Phase 6's
    -- dataClient() seam already puts it (recorded as G-11-08).
    if p_actor is null then
      raise exception using errcode = '22023', message = 'a server-side outcome must name its actor';
    end if;
    v_actor := p_actor;
  else
    raise exception using errcode = '42501', message = 'outcome recording requires a session';
  end if;

  select profile.role, profile.org_id
  into v_actor_role, v_actor_org
  from public.profiles as profile
  where profile.id = v_actor;

  if v_actor_role is null then
    raise exception using errcode = '42501', message = 'actor has no profile';
  end if;

  if (select auth.role()) = 'service_role'
    and v_actor_role <> 'platform_admin'
    and v_actor_org is distinct from v_client.org_id then
    raise exception using errcode = '42501', message = 'client is not reachable';
  end if;

  insert into public.outcomes (
    application_id, bank_ref, client_id, kind, amount_cents,
    recorded_by, recorded_by_kind, decided_on
  )
  values (
    v_application.id,
    v_application.bank_ref,
    v_application.client_id,
    p_kind,
    p_amount_cents,
    v_actor,
    case when v_actor_role = 'consumer' then 'consumer'::public.application_note_author_kind
         else 'operator'::public.application_note_author_kind end,
    coalesce(p_decided_on, current_date)
  )
  returning id into v_outcome_id;

  -- The pending review row is not created here. `public.outcomes` grants insert
  -- to `authenticated` and carries an insert policy, so an outcome can arrive
  -- without passing through this function at all; a review row created only on
  -- this path would leave those outcomes with no correction record and put the
  -- #113 path out of a platform admin's reach for exactly the entries most
  -- likely to need it. The trigger below owns it instead.

  return v_outcome_id;
end;
$$;

create function public.review_outcome(
  p_outcome_id uuid,
  p_decision public.outcome_review_state,
  p_actor uuid
)
returns table (
  result text,
  review_state public.outcome_review_state,
  outbox_state text,
  notified boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome public.outcomes;
  v_review public.outcome_reviews;
  v_actor_role public.app_role;
  v_recipient uuid;
  v_org uuid;
  v_outbox_state text;
  v_notified boolean := false;
begin
  if p_decision = 'pending' then
    raise exception using errcode = '22023', message = 'a review decision is approved or removed';
  end if;

  if p_actor is null then
    raise exception using errcode = '42501', message = 'a review decision must name its actor';
  end if;

  if (select auth.role()) = 'authenticated' and p_actor <> (select auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'a review decision is recorded under the session that made it';
  end if;

  if (select auth.role()) not in ('authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'a review decision requires a session';
  end if;

  -- Reading profiles.role for an explicit actor is the same definition
  -- private.auth_app_role() uses, not a second one; only the way the actor is
  -- identified differs between the browser-scoped and server-side callers.
  select profile.role into v_actor_role
  from public.profiles as profile
  where profile.id = p_actor;

  if v_actor_role is distinct from 'platform_admin'::public.app_role then
    raise exception using errcode = '42501', message = 'only a platform admin decides a correction';
  end if;

  select * into v_outcome from public.outcomes as outcome where outcome.id = p_outcome_id
  for update;

  if v_outcome.id is null then
    raise exception using errcode = 'P0002', message = 'outcome not found';
  end if;

  select * into v_review
  from public.outcome_reviews as review
  where review.outcome_id = p_outcome_id
  for update;

  if v_review.id is null then
    -- private.ensure_outcome_review makes this unreachable for any row inserted
    -- after this migration; it is here so a pre-existing outcome fails loudly
    -- rather than reporting a decision it never recorded.
    raise exception using errcode = 'P0002', message = 'outcome has no correction record';
  end if;

  if v_review.state = p_decision then
    select outbox.state into v_outbox_state
    from public.vault_writeback_outbox as outbox
    where outbox.outcome_id = p_outcome_id;

    return query select 'unchanged'::text, v_review.state, v_outbox_state, false;
    return;
  end if;

  update public.outcome_reviews as review
  set state = p_decision, reviewed_by = p_actor, reviewed_at = now()
  where review.id = v_review.id
  returning * into v_review;

  select client.org_id, coalesce(client.assigned_to, v_outcome.recorded_by)
  into v_org, v_recipient
  from public.clients as client
  where client.id = v_outcome.client_id;

  if p_decision = 'approved' then
    if v_outcome.state = 'removed' then
      update public.outcomes as outcome
      set state = 'counted', removed_at = null, removed_by = null
      where outcome.id = p_outcome_id
      returning * into v_outcome;
    end if;

    -- APPS-03. The row is the durable, tagged intent; delivery is KA-11-1.
    insert into public.vault_writeback_outbox (
      outcome_id, bank_ref, target, payload
    )
    values (
      v_outcome.id,
      v_outcome.bank_ref,
      'bank_datapoints',
      jsonb_build_object(
        'bank_ref', v_outcome.bank_ref,
        'outcome_kind', v_outcome.kind::text,
        'amount_cents', to_jsonb(v_outcome.amount_cents),
        'decided_on', v_outcome.decided_on::text
      )
    )
    on conflict (outcome_id) do nothing;
  else
    update public.outcomes as outcome
    set state = 'removed', removed_at = now(), removed_by = p_actor
    where outcome.id = p_outcome_id
    returning * into v_outcome;

    -- Nothing has left the system while the row is still `recorded`, so the
    -- staged write-back goes with the correction. A `delivered` row is left
    -- alone: it is a record of something that actually happened and deleting it
    -- would make the outbox lie about the past.
    delete from public.vault_writeback_outbox as outbox
    where outbox.outcome_id = p_outcome_id and outbox.state = 'recorded';
  end if;

  select outbox.state into v_outbox_state
  from public.vault_writeback_outbox as outbox
  where outbox.outcome_id = p_outcome_id;

  if v_recipient is not null and v_org is not null then
    insert into public.outcome_notifications (org_id, outcome_id, recipient_profile_id, kind)
    values (
      v_org,
      p_outcome_id,
      v_recipient,
      case when p_decision = 'approved' then 'outcome_review_approved'::public.outcome_notification_kind
           else 'outcome_review_removed'::public.outcome_notification_kind end
    )
    on conflict (outcome_id, recipient_profile_id, kind) do nothing;
    v_notified := found;
  end if;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, meta
  )
  values (
    v_org,
    v_outcome.client_id,
    p_actor,
    'outcome.review.decided',
    'outcome',
    p_outcome_id,
    jsonb_build_object('from_state', 'pending', 'to_state', p_decision::text)
  );

  return query select 'decided'::text, v_review.state, v_outbox_state, v_notified;
end;
$$;

comment on function public.review_outcome(uuid, public.outcome_review_state, uuid) is
  'The #113 correction path, and the only way an outcome''s state changes after '
  'entry. Repeating a decision that is already in force reports "unchanged" and '
  'writes nothing, so a double-submitted form produces no second write-back and '
  'no second alert; changing a decision is allowed, because an admin who '
  'approved in error must be able to correct that too.';

-- ---------------------------------------------------------------------------
-- Windows helper, and the triggers that keep the queue honest.
-- ---------------------------------------------------------------------------

create function private.ensure_outcome_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.outcome_reviews (outcome_id)
  values (new.id)
  on conflict (outcome_id) do nothing;
  return null;
end;
$$;

comment on function private.ensure_outcome_review() is
  'Every outcome gets its pending correction record the moment it exists, in '
  'the same transaction, whichever path inserted it. Leaving this to the '
  'service layer would mean an outcome written straight through the insert '
  'policy has nothing for public.review_outcome to decide on, which is the one '
  'case where a platform admin most needs the #113 path. The row is pending and '
  'changes nothing about the count (APPS-02).';

create function private.enqueue_outcome_refresh_on_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_outcome_refresh_job(new.bank_ref, new.id);
  return null;
end;
$$;

create function private.enqueue_outcome_refresh_on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_ref text;
begin
  select outcome.bank_ref into v_bank_ref
  from public.outcomes as outcome
  where outcome.id = new.outcome_id;

  if v_bank_ref is not null then
    -- Keyed on the decision rather than on the review row (ask-3). The review
    -- row is the latest decision, not the decision itself, so an admin who
    -- approves and later corrects reaches the same row twice; keying on the row
    -- alone would make the correction collide with the already-succeeded
    -- approval job and APPS-04's recompute would be swallowed as a duplicate.
    -- The md5 of the row and the state it reached names the decision, is stable
    -- if the same decision somehow fires twice, and needs no extension beyond
    -- what pg_catalog already provides.
    perform public.enqueue_outcome_refresh_job(
      v_bank_ref,
      md5(new.id::text || ':' || new.state::text)::uuid
    );
  end if;

  return null;
end;
$$;

create trigger outcomes_ensure_review
after insert on public.outcomes
for each row execute function private.ensure_outcome_review();

create trigger outcomes_enqueue_refresh
after insert on public.outcomes
for each row execute function private.enqueue_outcome_refresh_on_outcome();

create trigger outcome_reviews_enqueue_refresh
after update of state on public.outcome_reviews
for each row
when (old.state is distinct from new.state)
execute function private.enqueue_outcome_refresh_on_review();

-- ---------------------------------------------------------------------------
-- Execution privileges. The queue is the worker's; the two write paths are
-- reachable from a browser session and defend themselves inside the function.
-- ---------------------------------------------------------------------------

revoke all on function public.enqueue_outcome_refresh_job(text, uuid) from public;
revoke all on function public.claim_outcome_refresh_job(text, integer) from public;
revoke all on function public.run_outcome_refresh_job(uuid, text) from public;
revoke all on function public.fail_outcome_refresh_job(uuid, text, text, boolean, integer) from public;
revoke all on function public.record_outcome(uuid, public.outcome_kind, bigint, date, uuid) from public;
revoke all on function public.review_outcome(uuid, public.outcome_review_state, uuid) from public;
revoke all on function private.outcome_window_agg(jsonb, date) from public;
revoke all on function private.audit_outcome_refresh_transition(
  public.outcome_refresh_jobs, text, text
) from public;

grant execute on function public.enqueue_outcome_refresh_job(text, uuid) to service_role;
grant execute on function public.claim_outcome_refresh_job(text, integer) to service_role;
grant execute on function public.run_outcome_refresh_job(uuid, text) to service_role;
grant execute on function public.fail_outcome_refresh_job(uuid, text, text, boolean, integer)
  to service_role;
grant execute on function public.record_outcome(uuid, public.outcome_kind, bigint, date, uuid)
  to authenticated, service_role;
grant execute on function public.review_outcome(uuid, public.outcome_review_state, uuid)
  to authenticated, service_role;
