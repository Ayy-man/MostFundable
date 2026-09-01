-- 080_applications_outcomes.sql — Phase 11 (S2.3), APPS-01 and APPS-02.
--
-- Four tables and eight enums that make two requirements properties of the
-- schema rather than promises made by application code:
--
--   APPS-01  an application carries an operator status, a consumer status, an
--            amount and a visibility, and its shared note thread carries the
--            operator attestation as a check constraint — so a caller cannot
--            post an operator note without it and no surface can forget to
--            render the box.
--   APPS-02  an outcome counts the moment it is inserted, because
--            `outcomes.state` defaults to 'counted'. There is no code path to
--            consult and no review to pass; the platform-admin review that
--            migration 081 decides is a correction path, not a gate (log #113).
--
-- Everything here is additive. Migrations 001–004, 010–012, 020–024, 030 and
-- 050–052 are untouched, and no object in this file writes `clients.stage`,
-- `clients.stage_entered_at` or `public.stage_history` — Applying and Funded
-- moves go through Phase 6's frozen `tracker_transition_client_stage` seam.

create type public.application_operator_status as enum ('wait', 'todo');
create type public.application_consumer_status as enum ('approved', 'pending', 'denied');
create type public.application_visibility as enum ('inherit', 'details', 'status_only');
create type public.application_note_author_kind as enum ('consumer', 'operator');
create type public.outcome_kind as enum ('approved', 'denied', 'withdrawn');
create type public.outcome_state as enum ('counted', 'removed');
create type public.outcome_review_state as enum ('pending', 'approved', 'removed');

-- Declared here with its siblings so every enum this phase owns lives in one
-- migration; migration 081 is where `outcome_notifications` uses it.
create type public.outcome_notification_kind as enum (
  'outcome_review_approved',
  'outcome_review_removed'
);

create table public.applications (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bank_ref text not null,
  operator_status public.application_operator_status not null default 'wait',
  consumer_status public.application_consumer_status not null default 'pending',
  amount_cents bigint,
  visibility public.application_visibility not null default 'inherit',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_bank_ref_shape check (bank_ref ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  constraint applications_amount_nonnegative check (amount_cents is null or amount_cents >= 0),
  constraint applications_client_bank_unique unique (client_id, bank_ref),
  constraint applications_id_bank_unique unique (id, bank_ref)
);

create index applications_client_created_at_idx
  on public.applications(client_id, created_at desc);

comment on table public.applications is
  'One tab per bank per client (log #53). Operator status, consumer status, '
  'amount and visibility are APPS-01; the visibility override is per '
  'application and defaults to inheriting the client-level setting.';

comment on constraint applications_bank_ref_shape on public.applications is
  'A deliberate stand-in for the banks_cache foreign key, not an oversight. '
  'Phase 8 (lane D, migrations 040-049) owns banks_cache and has not run, and '
  'the 47-vs-688 bank-list question is still open, so inventing the table here '
  'would pre-empt that read model. Phase 8 adds the foreign key; until then a '
  'bank reference is a format-checked opaque handle. Recorded as ask-1 in '
  '.planning/lanes/phase-11.md.';

comment on constraint applications_id_bank_unique on public.applications is
  'The parent key for the composite foreign key on public.outcomes. Without '
  'it, changing an application''s bank would silently re-file every outcome '
  'already recorded against the old one.';

create table public.application_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id),
  author_kind public.application_note_author_kind not null,
  body text not null,
  attested boolean not null default false,
  created_at timestamptz not null default now(),
  constraint application_notes_operator_attestation check (
    (author_kind = 'operator' and attested)
    or (author_kind = 'consumer' and not attested)
  ),
  constraint application_notes_body_length check (char_length(body) between 1 and 4000)
);

create index application_notes_application_created_at_idx
  on public.application_notes(application_id, created_at);

create trigger application_notes_prevent_change
before update or delete on public.application_notes
for each row execute function private.prevent_row_change();

comment on table public.application_notes is
  'The shared operator/consumer thread on one application. Append-only through '
  'Phase 1''s private.prevent_row_change trigger, so an attestation cannot be '
  'retro-fitted and a note cannot be rewritten after the other side read it.';

comment on constraint application_notes_operator_attestation on public.application_notes is
  'APPS-01''s attestation checkbox, expressed as a constraint. It rejects both '
  'wrong shapes: an operator note without the attestation, and a consumer note '
  'carrying one. A form can forget to render a box; the database cannot forget '
  'this.';

create table public.outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  application_id uuid not null,
  bank_ref text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind public.outcome_kind not null,
  amount_cents bigint,
  state public.outcome_state not null default 'counted',
  recorded_by uuid references public.profiles(id),
  recorded_by_kind public.application_note_author_kind not null,
  decided_on date not null default current_date,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  constraint outcomes_application_bank_fk
    foreign key (application_id, bank_ref)
    references public.applications(id, bank_ref)
    on delete cascade,
  constraint outcomes_amount_shape check (
    (kind = 'approved' and amount_cents is not null and amount_cents > 0)
    or (kind <> 'approved' and amount_cents is null)
  ),
  constraint outcomes_removed_shape check (
    (state = 'counted' and removed_at is null and removed_by is null)
    or (state = 'removed' and removed_at is not null and removed_by is not null)
  )
);

create unique index outcomes_one_counted_per_application
  on public.outcomes (application_id)
  where state = 'counted';

create index outcomes_bank_decided_on_idx
  on public.outcomes (bank_ref, decided_on desc)
  where state = 'counted';

create index outcomes_client_created_at_idx
  on public.outcomes (client_id, created_at desc);

comment on table public.outcomes is
  'APPS-02. An outcome counts on entry because `state` defaults to ''counted'', '
  'so the requirement holds even if every line of application code is wrong. '
  'A platform admin corrects a bad entry through migration 081''s '
  'public.review_outcome, which tombstones this row rather than deleting it.';

comment on index public.outcomes_one_counted_per_application is
  'The `where state = ''counted''` predicate is the whole constraint, not an '
  'optimisation. A plain unique key on application_id would make a correction '
  'impossible, because the tombstoned row would still occupy the slot. Do not '
  'replace this with a table-level unique constraint: a table constraint '
  'cannot carry a predicate.';

comment on constraint outcomes_amount_shape on public.outcomes is
  'Pins the amount to the kind in both directions. Without it, the approved '
  'amount sum that BACKEND-SPEC hands the fee model would silently under-count '
  'on a null.';

comment on constraint outcomes_removed_shape on public.outcomes is
  'A tombstone always names its actor and its moment. This is the audit hole '
  'a nullable pair without a check would leave open.';

create table public.outcome_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  outcome_id uuid not null unique references public.outcomes(id) on delete cascade,
  state public.outcome_review_state not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reason_code text,
  created_at timestamptz not null default now(),
  constraint outcome_reviews_decision_shape check (
    (state = 'pending' and reviewed_by is null and reviewed_at is null)
    or (state <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  ),
  constraint outcome_reviews_reason_code_length check (
    reason_code is null or char_length(reason_code) between 1 and 64
  )
);

create index outcome_reviews_pending_idx
  on public.outcome_reviews (state, created_at)
  where state = 'pending';

comment on table public.outcome_reviews is
  'The #113 correction path. The row is created ''pending'' in the same '
  'transaction as the outcome it reviews, so a pending review and a counted '
  'outcome coexist by construction and a reviewer who never opens the queue '
  'changes nothing about the count.';

-- ---------------------------------------------------------------------------
-- Row security. Per-client reach is Phase 1's private.can_access_client, reused
-- verbatim rather than restated, so this phase adds no second definition of who
-- may see a client that could drift from the first.
-- ---------------------------------------------------------------------------

alter table public.applications enable row level security;
alter table public.applications force row level security;
alter table public.application_notes enable row level security;
alter table public.application_notes force row level security;
alter table public.outcomes enable row level security;
alter table public.outcomes force row level security;
alter table public.outcome_reviews enable row level security;
alter table public.outcome_reviews force row level security;

revoke all on table public.applications from anon, authenticated;
revoke all on table public.application_notes from anon, authenticated;
revoke all on table public.outcomes from anon, authenticated;
revoke all on table public.outcome_reviews from anon, authenticated;

grant select, insert, update on table public.applications to authenticated;
grant select, insert on table public.application_notes to authenticated;
grant select, insert on table public.outcomes to authenticated;
grant select on table public.outcome_reviews to authenticated;

grant all on table public.applications to service_role;
grant all on table public.application_notes to service_role;
grant all on table public.outcomes to service_role;
grant all on table public.outcome_reviews to service_role;

create policy applications_select_scoped
on public.applications
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy applications_insert_scoped
on public.applications
for insert
to authenticated
with check ((select private.can_access_client(client_id)));

create policy applications_update_scoped
on public.applications
for update
to authenticated
using ((select private.can_access_client(client_id)))
with check ((select private.can_access_client(client_id)));

create policy application_notes_select_scoped
on public.application_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.applications as application
    where application.id = application_notes.application_id
      and (select private.can_access_client(application.client_id))
  )
);

create policy application_notes_insert_scoped
on public.application_notes
for insert
to authenticated
with check (
  author_profile_id = (select private.auth_profile_id())
  and exists (
    select 1
    from public.applications as application
    where application.id = application_notes.application_id
      and (select private.can_access_client(application.client_id))
  )
);

create policy outcomes_select_scoped
on public.outcomes
for select
to authenticated
using ((select private.can_access_client(client_id)));

create policy outcomes_insert_scoped
on public.outcomes
for insert
to authenticated
with check ((select private.can_access_client(client_id)));

-- Read only, and no write policy at all. An operator has a direct incentive to
-- erase its own unfavourable entry, which is the entire point of the #113
-- correction path, so a decision is reachable only through migration 081's
-- security-definer public.review_outcome and its platform_admin check.
create policy outcome_reviews_select_scoped
on public.outcome_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.outcomes as outcome
    where outcome.id = outcome_reviews.outcome_id
      and (select private.can_access_client(outcome.client_id))
  )
);
